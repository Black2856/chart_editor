// 形式に依存しない単一の内部表現。パーサ／エディタ／難易度算出はすべてこれを共有する。

export type NoteType = 0 | 1; // 0=tap, 1=long

export interface Note {
  time: number; // ms 判定基準時刻 (chartTime)
  lane: number; // 0..keyCount-1
  type: NoteType; // 0=tap, 1=long
  dur: number; // ms long の長さ。tap は 0
}

export interface BpmChange {
  time: number; // ms
  bpm: number;
}

export interface TimingInfo {
  offsetMs: number; // 最初の拍位置
  bpm: number; // 基本BPM
  bpmChanges?: BpmChange[]; // 将来拡張用 (スナップ用途、ソフランI/Oは非対応)
}

export interface ChartMeta {
  title?: string;
  artist?: string;
  creator?: string;
  version?: string;
}

export interface DifficultyResult {
  overall: number; // 生スコア (txt に埋め込む値)
  star: number; // 1..20
  stats: {
    totalNotes: number;
    durationSec: number;
    avgNps: number;
    maxNps: number;
    peakNps: number;
  };
  difficulty: {
    density: number;
    jack: number;
    trill: number;
    chord: number;
    ln: number;
    movement: number;
    rhythm: number;
  };
}

export interface Chart {
  id: string; // ノーツ内容ハッシュ先頭16桁(hex)
  name: string; // 表示名 (ファイル名など)
  format: 'osu' | 'txt';
  keyCount: number;
  notes: Note[]; // time 昇順 (不変条件)
  timing: TimingInfo;
  audioFilename?: string;
  meta?: ChartMeta;
  difficulty?: DifficultyResult;
}

export function isLong(n: Note): boolean {
  return n.type === 1;
}

export function noteEnd(n: Note): number {
  return n.type === 1 ? n.time + n.dur : n.time;
}

/** time 昇順を保証する比較。同時刻は lane 昇順。 */
export function compareNotes(a: Note, b: Note): number {
  return a.time - b.time || a.lane - b.lane;
}

/** notes を time 昇順へ正規化 (破壊的)。 */
export function sortNotes(notes: Note[]): Note[] {
  notes.sort(compareNotes);
  return notes;
}

/** 全ノーツから keyCount を推定 (max lane + 1)。最低 1。 */
export function inferKeyCount(notes: Note[], fallback = 4): number {
  let max = -1;
  for (const n of notes) if (n.lane > max) max = n.lane;
  return max < 0 ? fallback : max + 1;
}
