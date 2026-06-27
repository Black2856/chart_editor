# 譜面エディター

AI生成譜面を手動編集して「いいとこ取り」するための mania 型（縦スクロール）譜面エディター。
設計の詳細は [`DESIGN.md`](./DESIGN.md) を参照。

## セットアップ

```bash
npm install
npm run dev      # 開発サーバ (http://localhost:5173)
npm run build    # 本番ビルド (型チェック + バンドル)
npm test         # コアロジックの単体テスト (vitest)
```

## 主な機能

- **入出力**: osu!(mania) ⇄ 独自 txt の相互変換。キー数はファイルから自動判定。
  - txt: `<id16>,<star>:<time,lane,type[,dur]>/...`（id はノーツ内容ハッシュ、star は難易度指数 = overall÷3 を小数第1位）
- **配置**: Tap / Long ツール。BPM・オフセット基準のスナップ（フリー / 全・2・4・8・12(3連)・16・24・32・48分）＋既存ノーツ吸着。「フリー」で自由配置・自由移動。
- **編集**: 矩形選択 → 削除 / 移動 / コピペ、Undo/Redo、選択LNのTap化（LN除去）。
- **表示位置**: チャート全体を左／中央／右に寄せて表示（首が疲れないよう中央表示など）。
- **デモ再生**: Web Audio による音楽 + SE（`notesound/soft-hitnormal.ogg`）の同期再生。シークバーで任意位置へ移動。停止時に開始位置へ戻るオプションあり。
- **マーキング**: 再生位置にマーカーを置き（線表示）、前後ジャンプ。比較時の目印に。
- **難易度指数**: ローカル strain のピーク集約（休憩区間に引っ張られない・長さ非依存）。star = overall÷3（小数第1位）。編集に追従して再計算。
- **複数譜面比較（独自機能）**: 横並びパネル・スクロール同期・再生対象選択・**パネル間ノーツ移動**。

## 操作

| 操作 | キー / 入力 |
|---|---|
| スクロール / ズーム | ホイール / Ctrl+ホイール |
| ツール切替 | 1=選択 2=Tap 3=Long 4=削除 |
| 配置 | Tap=クリック、Long=ドラッグ |
| 選択・移動 | 選択ツールで矩形ドラッグ → ドラッグ移動。別パネルへドロップで譜面間移動 |
| 削除 / コピペ | Del / Ctrl+C, Ctrl+V（再生位置基準） |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y |
| 再生 / 先頭 | Space / ツールバー |
| シーク | ツールバー下のシークバーをドラッグ |
| マーカー | M（追加/削除）/ ツールバーの ◆ ◀ ▶ 消去 |
| 選択を微調整 | ↑↓=スナップ単位で時間移動（フリー時10ms）、←→=レーン移動 |

「譜面を開く」で `.osu` / `.txt` を、「音源」で音声ファイルを読み込んで使います（譜面・音源はリポジトリに同梱していません）。

## 構成

```
src/
  core/        types / hash / formats(osu,txt) / difficulty / snap / selection  ← フレームワーク非依存
  audio/       engine.ts  Web Audio 再生
  stores/      charts.ts  Pinia ストア (パネル・編集・再生・ビュー状態)
  components/  Toolbar / EditorPanel(Canvas) / TimingPanel / DifficultyPanel / CompareView
```
