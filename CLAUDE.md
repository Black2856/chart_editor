# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

mania 型（縦スクロール・レーン）の譜面エディター。AI生成譜面を手動編集して「いいとこ取り」するのが目的。
設計の基準書は `DESIGN.md`、使い方は `README.md`。
（初期の要件メモ `pronpt.md`・難易度の参照実装 `diff_index.txt`・動作確認用 `sample/` はリポジトリには含めていない。譜面・音源は実行時にユーザーがファイルから読み込む。）

## コマンド

```bash
npm run dev        # 開発サーバ (http://localhost:5173)
npm run build      # vue-tsc --noEmit + vite build
npm test           # vitest（単体テスト、1回実行）
npm run test:watch # vitest ウォッチ
npm run typecheck  # vue-tsc --noEmit のみ
npx vitest run src/core/__tests__/difficulty.test.ts   # 単一ファイル
npx vitest run -t "rest sections"                      # テスト名で絞る
```

テストは `src/core/`（フレームワーク非依存ロジック）のみが対象。`__tests__/` 内のインライン osu フィクスチャでラウンドトリップ・難易度を検証する（外部ファイル依存なし）。UI/ブラウザ確認は chrome-devtools MCP で dev サーバを開いて行う（プロジェクトに E2E は無い）。

## 重要な落とし穴

- **build は必ず `vue-tsc --noEmit`**（`vue-tsc -b` は禁止）。`-b` は `src/` に `.js` をemitしてしまい、拡張子なし import が古い `.js` を解決して挙動が更新されなくなる。`src/**/*.js` が現れたら全てステイルなので削除すること（ソースは `.ts`/`.vue`/`.css` のみ）。`tsconfig.json` は `noEmit: true`。

## アーキテクチャ（全体像）

レイヤは「FW非依存コア → Pinia ストア → Vue/Canvas UI」の一方向。

### 単一の内部表現（`src/core/types.ts`）
すべての層が同じ `Note { time, lane, type(0=tap/1=long), dur }` と `Chart` を共有する。**不変条件: `notes` は常に `time` 昇順**。挿入・編集後は `sortNotes` で正規化する。`keyCount` はファイルから自動判定（`inferKeyCount` = max lane + 1）。

### `src/core/`（FW非依存・テスト対象）
- `formats/osu.ts` … osu! mania(Mode3)。レーン⇔x = `floor(x*keyCount/512)`、`type` bit0=tap・bit7(128)=long(objParams先頭=endTime)、`y`無視。ソフラン/ノーツサウンドはI/O非対応。
- `formats/txt.ts` … 独自形式 `<id16>,<star>:<time,lane,type[,dur]>/...`。ヘッダは `:` で終端、難易度フィールドは **star**（= overall÷3 を `toFixed(1)`）。
- `hash.ts` … 譜面id = **ノーツ内容のみ**の FNV-1a64 先頭16桁。難易度や尺は混ぜない（同一譜面は osu/txt 間で同一id）。
- `difficulty/` … strain ベースの難易度（後述）。
- `snap.ts` … 拍グリッド。`stepBeats`（4分=1.0）。`stepBeats<=0` は「フリー」＝グリッド無視。`snapTime` がグリッドと既存ノーツ吸着の近い方を返す。
- `selection.ts` … 選択ノーツの平行移動・クリップボード・矩形抽出（純粋関数）。

### 難易度（`src/core/difficulty/`）
休憩区間に引っ張られない設計が要点。`features.ts` で各ノーツの局所寄与（jack/trill/chord/ln/movement/rhythm）を O(n) で出し、`analyze.ts` が固定ホップの時間窓で**毎秒レート**の strain 系列を作り、**降順ソート＋減衰加重平均（ピーク集約）**で `overall` を出す（長さ非依存・休憩ロバスト）。`star = round(overall/3, 1)`。重み・`DECAY`・`STAR_DIV`・`HOP`/`WINDOW` は `analyze.ts` 冒頭の定数で**調整可能**（コーパス無しの暫定較正）。

### 状態管理（`src/stores/charts.ts`）— 中心
読み込んだ譜面は `panels`（各 `Panel`）として保持。ビュー状態（`currentTime`/`pxPerMs`/`tool`/`snapIndex`/`chartAlign`）と再生・マーカーもここに集約。**編集系アクション（addNote/deleteNotes/moveSelection/paste/removeLnFromSelection/moveNotesToPanel/undo/redo）はすべてストア経由**。各アクションは「pushUndo → ノーツ書換 → `setNotes`（sort＋難易度再計算＋`rev`/`selectionVersion`更新）」のパターン。
- **パフォーマンス上の約束**: `Panel.notes` と `selection`・`edges` は `markRaw`（Vue の deep reactivity を回さない）。Canvas は notes を直接読み、変更通知は `rev` カウンタで行う。難易度・件数など UI 表示はリアクティブ。
- **LN 端単位の選択**: `Panel.edges`（`Map<Note,'head'|'tail'>`・未登録は `'both'`）で LN の片端のみ選択を表現。`moveSelection` は `selection.ts` の `applyEdgeMove` で端だけ伸縮（`'both'` は全体移動）。端は EditorPanel で「端をつかむ（`edgeAt`）」か「矩形が片端だけを覆う（`notesInRectWithEdges`）」と確定。
- Undo はスナップショット方式（`notes` を都度クローン、上限 `UNDO_LIMIT`）。
- 再生は `src/audio/engine.ts`（Web Audio）。音楽は1トラック共有、SE は `playbackPanelId` の譜面ノーツを lookahead スケジューリング。`currentTime` は rAF で `engine.currentMs()` から更新。

### UI（`src/components/`）
- `EditorPanel.vue` … 譜面1枚のCanvas。**Vueの再描画ではなく自前の rAF ループで毎フレーム描画**。座標系は `timeToY/yToTime`（時間=縦、判定線=`JUDGE_FRAC`の位置）と `laneToX/xToLane`。ポインタ操作でツールに応じた配置/選択/移動を行う。
- パネル間ノーツ移動は **`window.__panelCanvasRegistry__`**（各 canvas を登録）で drop 先パネルをヒットテストして実現。
- 合成イベント対策で `setPointerCapture` は try/catch で囲む（実ユーザー操作では不要だが防御的に必須）。
- `CompareView.vue` … 複数 `EditorPanel` を横並び。`chartAlign` を `justify-content`（`safe` 付き）で反映（チャート全体の表示位置＝首が疲れない用）。スクロール位置・再生位置は `currentTime` 共有で同期。
- `Toolbar.vue` … 3段（編集／再生・サウンド／シーク）構成。`App.vue` がグローバルキー（Space/Del/Ctrl+C,V,Z,Y/矢印/1-4/M）を処理。

## 言語

UI・コメント・コミットは日本語。技術用語とコード識別子は原語のまま。
