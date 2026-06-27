# 譜面エディター 設計書

初期の要件メモ `pronpt.md` と難易度参照実装 `diff_index.txt`（いずれも現在はリポジトリ非同梱）を基に、実装の基準となる設計を定める。
要件で曖昧だった点はユーザー確認済みの決定で確定させている。

---

## 1. 目的とスコープ

AI生成譜面を手動編集して「いいとこ取り」するための mania 型（縦スクロール・レーン）譜面エディター。

- 配置: tap / long の配置、テンポ基準スナップ（全/2/4/8分・3連符）、既存ノーツ吸着
- 編集: 範囲選択 → 削除 / 移動 / コピペ
- 再生: 音楽 + SE のデモ再生
- 独自機能: 複数譜面の同時読込・スクロール同期・再生対象選択・パネル間ノーツ移動
- 難易度指数の算出
- 入出力: osu(mania) ⇄ txt 相互変換

---

## 2. 技術スタック / プロジェクト構成

- **Vue 3 + TypeScript + Vite**。譜面描画は **Canvas**、UI は Vue コンポーネント。
- 複数譜面・選択状態などの共有状態は **Pinia**（または composable）で管理。
- 譜面描画はノーツ数が多い（サンプル約4000）ため Canvas に集約し、Vue の再描画から切り離す。

```
chart_editor/
  index.html, package.json, vite.config.ts, tsconfig.json
  src/
    main.ts, App.vue
    core/
      types.ts            # Note, Chart, TimingInfo, DifficultyResult
      hash.ts             # 16桁(hex)コンテンツハッシュ
      formats/
        osu.ts            # osu(mania) parse / serialize
        txt.ts            # txt parse / serialize
      difficulty/
        analyze.ts        # strain ベース難易度算出（diff_index.txt を参照に再設計）
        features.ts       # 局所特徴量（density/jack/trill/chord/ln/movement/rhythm）
      snap.ts             # 拍グリッド生成・スナップ
      selection.ts        # 選択・クリップボード操作
    audio/
      engine.ts           # Web Audio 再生（音楽 + SE）
    components/
      Toolbar.vue, TimingPanel.vue, DifficultyPanel.vue
      EditorPanel.vue     # 単一譜面 Canvas パネル
      CompareView.vue     # 横並び複数パネルのコンテナ
    stores/
      charts.ts           # 読込済み譜面・選択・再生対象の状態
  notesound/               # SE 用 ogg (同梱)
```

---

## 3. データモデル（内部表現）

形式に依存しない単一の内部表現を持ち、パーサ／エディタ／難易度算出はすべてこれを共有する。

```ts
interface Note {
  time: number;     // ms 判定基準時刻（chartTime）
  lane: number;     // 0..keyCount-1
  type: 0 | 1;      // 0=tap, 1=long
  dur: number;      // ms long の長さ。tap は 0
}

interface TimingInfo {
  offsetMs: number;            // 最初の拍位置
  bpm: number;                 // 基本BPM（txtは手動入力）
  bpmChanges?: { time: number; bpm: number }[]; // 将来拡張（スナップ用、ソフランI/Oは非対応）
}

interface Chart {
  id: string;                  // ノーツ内容ハッシュ先頭16桁(hex)
  keyCount: number;            // 自動判定
  notes: Note[];               // time 昇順（不変条件）
  timing: TimingInfo;
  audioFilename?: string;      // osu 由来 or 手動添付
  meta?: { title?: string; artist?: string; creator?: string; version?: string };
  difficulty?: DifficultyResult;
}
```

不変条件: `notes` は常に `time` 昇順。挿入は二分探索で位置決め。難易度・スナップは「先頭付近のみ走査」前提を活かす。

---

## 4. ファイル形式仕様

### 4.1 osu 形式（mania / Mode 3）

- **キー数**: `[Difficulty] CircleSize` = レーン数。
- **レーン ⇄ x 変換**: `lane = floor(x * keyCount / 512)`（4Kなら `floor(x/128)`、x=64/192/320/448 → 0..3）。出力は `x = floor((lane + 0.5) * 512 / keyCount)`。`y` は常に 192（無視）。
- **HitObject**: `x,y,time,type,hitSound,objParams,hitSample`
  - `type` bit0(1)=通常ノーツ → tap、bit7(128)=ホールド → long。
  - long の `objParams` 先頭が `endTime`（例 `64,192,34164,128,0,34536:...` → time=34164, endTime=34536, dur=2372）。
- **TimingInfo**: `[TimingPoints]` の最初の正の `beatLength` から `bpm = 60000 / beatLength`、`offsetMs = time`。複数 TimingPoint（ソフラン）は **I/O 非対応**でよい（スナップ用に基本BPMのみ採用、SV行 `-` は無視）。
- **ノーツサウンドは非対応**: 出力 hitSample は固定値（`0:0:0:0:` 等）でよい。
- メタデータ（Title/Artist/Creator/Version、AudioFilename）は読込時に保持し、出力で書き戻す。

### 4.2 txt 形式

1行（パース時は `:` 後の改行も許容）。

```
<id16>,<overall>:<note>/<note>/<note>/...
```

- **ヘッダ**: `譜面id(16桁hex),難易度指数` を `,` 区切り、`:` で終端。
  - `id16` = ノーツ内容ハッシュの先頭16桁（§6）。
  - `難易度指数` = `star`（= `overall` ÷ 3 を小数第1位）。出力は `star.toFixed(1)`。
- **ノーツ**: `:` の後に `time,lane,type[,dur]` を `/` 区切り。
  - 3値=tap（`time,lane,0`）、4値=long（`time,lane,1,dur`）。すべて ms ベース。
  - `time` 昇順前提。
- **keyCount**: txt に明示が無いため `max(lane)+1` で自動判定。
- 出力時にヘッダの `overall` を再計算して埋め込む。

---

## 5. 難易度指数アルゴリズム（strain ベース・休憩ロバスト）

`diff_index.txt` は **サンプル/参照**。リテラル移植せず、以下方針で再設計する。
狙い: **長さ非依存**かつ**休憩・無音区間に引っ張られない**こと。

### 5.1 局所強度（strain）系列
- タイムラインを固定ホップ（既定 100ms）でサンプリングし、各点 `t` で直前ウィンドウ `[t-W, t]`（既定 W=1000ms）の特徴量を計算。
- 特徴量はすべて**レート/強度（毎秒換算や正規化値）**で算出 → 局所的に長さ非依存:
  - `density`: ウィンドウ内 nps
  - `jack`: 同一レーン連打の近接度（間隔が短いほど高）
  - `trill`: A-B-A 交互＋安定間隔
  - `chord`: 同時押し本数（近接クラスタリングで判定、§5.3）
  - `ln`: アクティブなホールド＋ホールド中の別レーン tap 圧
  - `movement`: 短間隔でのレーン跳躍量
  - `rhythm`: 間隔の多様性／不規則さ
- `localStrain(t) = Σ weight_k * feature_k(t)`（重みは調整可能な定数表）

### 5.2 休憩を無視する集約
- strain 系列を降順ソートし、**ピーク加重和**で全体値を出す:
  - `overall = scale * Σ_i ( sorted[i] * decay^i )`（既定 decay=0.95）。
  - 低 strain（休憩）窓は順位が下になり decay で寄与が小さくなる → 休憩に支配されない。
  - 代替案（同等の意図）: 上位30%窓の加重平均。実装時に両者を比較し挙動の良い方を採用。
- `star = round(overall / 3, 1)`（小数第1位）。txt にはこの star を埋め込む。
- 内訳（density/jack/…）も**ピーク基準**で算出し UI 表示。

### 5.3 性能・正確性の補正（参照実装からの改善）
- `density` のウィンドウ計数は **O(n) スライディングウィンドウ**（参照の burst の O(n²) を解消）。LN 圧も区間スイープで O(n)。
- chord 判定は固定バケット丸め（境界で和音取りこぼし）ではなく、**時間近接クラスタリング**（許容 ±25ms 程度）で隣接境界の漏れを防ぐ。

### 5.4 入力アダプタ
内部 `Note` → 算出入力 `{ time, lane, endTime: type===1 ? time+dur : undefined }`。

### 5.5 出力
```ts
interface DifficultyResult {
  overall: number;            // 生スコア（txt に埋め込む値）
  star: number;               // 1..20
  stats: { totalNotes; durationSec; avgNps; maxNps; peakNps };
  difficulty: { density; jack; trill; chord; ln; movement; rhythm }; // ピーク基準内訳
}
```

---

## 6. 譜面id（16桁ハッシュ）

- 生成元 = **ノーツ内容のみ**（難易度・尺は混ぜない → ノーツ不変なら id 不変）。
- 正規化: `notes` を `time,lane,type,dur` 昇順で連結した正規文字列をハッシュ（例 FNV-1a 64bit など軽量ハッシュ）し、hex 先頭16桁を採用。
- 同一譜面は osu/txt いずれから読んでも同一 id → 形式間・比較パネル間で同一譜面を識別可能。

---

## 7. エディタ機能設計

### 7.1 描画（Canvas, 縦スクロール mania）
- レーンは縦、時間は縦軸（下から上 or 上から下、設定可）。`pxPerMs`（ズーム）で時間↔ピクセル変換。
- 拍線（小節/拍/分割）、tap/long（長さ分の帯）、再生ヘッド、スナップグリッドを描画。
- 表示範囲のノーツのみ描画（昇順 + 二分探索で可視区間を切り出し）。

### 7.2 タイミング & スナップ
- `TimingPanel.vue` で BPM / offset を手動入力（txt 用）。osu は TimingPoints から初期化。
- スナップ分解能: 1/1, 1/2, 1/4, 1/8, 1/3(3連), 1/6, 1/12 等を選択。
- スナップ時刻 = `offset + beatMs * (k / div)`。配置・移動時に最近傍グリッドへ吸着。
- 「既存ノーツ吸着」: 近傍ノーツの `time` にもスナップ候補を加える。

### 7.3 配置・編集
- クリックでレーン×スナップ位置に tap、ドラッグで long（始点→終点）。
- 範囲選択（矩形/時間範囲）→ 削除 / 平行移動（時間・レーン）/ コピー / ペースト（再生ヘッド基準）。
- 変更後は `notes` 昇順を維持し、難易度を再算出して `DifficultyPanel` を更新。
- Undo/Redo（編集スタック）を用意。

### 7.4 デモ再生（Web Audio API）
- `audio/engine.ts`: 音楽を `AudioBufferSourceNode` で再生し、再生位置（`currentTime`）から表示同期。
- SE: `notesound/soft-hitnormal.ogg` を tap / long 始点でスケジュール再生。whistle/finish/clap 等は当面未使用。
- 音楽参照は osu の `AudioFilename`、txt は手動添付（全譜面で共有）。

---

## 8. 独自機能: 複数譜面の同時比較

- `CompareView.vue` が複数 `EditorPanel` を**横並び**に配置。各パネルが独立レーン列を持つ。
- **スクロール同期**: 共有の時間カーソル/スクロール位置をストアで管理し、全パネルが同一時刻を表示。
- **再生対象選択**: どの譜面の音楽/SE を鳴らすかをストアで指定（音楽は共有、SE は対象譜面のノーツ）。
- **パネル間ノーツ移動**: あるパネルの選択ノーツを別パネルへドラッグ＆ドロップ。移動先 keyCount に応じてレーン制約を検証。移動元から削除し移動先へ挿入（両譜面の id・難易度を再算出）。

---

## 9. 実装フェーズ（MVP 優先・各段階で動作維持）

1. **基盤**: Vite + Vue3 + TS 雛形、`core/types.ts`、Pinia ストア骨組み。
2. **パーサ + 難易度**: `formats/osu.ts`・`formats/txt.ts`・`hash.ts`・`difficulty/*`、単体テスト（インラインフィクスチャでラウンドトリップ確認）。
3. **単一譜面レンダラ**: `EditorPanel` の Canvas 描画、ズーム、再生ヘッド。
4. **タイミング/スナップ/配置**: `TimingPanel`、`snap.ts`、tap/long 配置。
5. **選択編集**: `selection.ts`、削除/移動/コピペ、Undo/Redo。
6. **デモ再生**: `audio/engine.ts`、音楽 + SE 同期。
7. **複数譜面比較**: `CompareView`、同期スクロール、再生対象、パネル間移動。

各段階完了時に動く状態を保ち、難易度は2以降で常時再算出して表示する。
