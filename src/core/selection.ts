import type { Note } from './types';

// 選択ノーツの変換とクリップボード。すべて純粋関数 (ストアから利用)。

export function clampLane(lane: number, keyCount: number): number {
  return Math.max(0, Math.min(keyCount - 1, lane));
}

/** 選択ノーツを時間・レーン方向へ平行移動した新配列を返す。 */
export function translateNotes(
  notes: Note[],
  deltaTime: number,
  deltaLane: number,
  keyCount: number,
): Note[] {
  return notes.map((n) => ({
    time: Math.max(0, Math.round(n.time + deltaTime)),
    lane: clampLane(n.lane + deltaLane, keyCount),
    type: n.type,
    dur: n.dur,
  }));
}

export interface ClipItem {
  dt: number; // anchor からの相対時刻
  lane: number;
  type: 0 | 1;
  dur: number;
}

export interface Clipboard {
  anchorTime: number;
  minLane: number;
  items: ClipItem[];
}

/** 選択ノーツを相対表現でコピー。 */
export function copyNotes(notes: Note[]): Clipboard {
  if (notes.length === 0) return { anchorTime: 0, minLane: 0, items: [] };
  const anchorTime = Math.min(...notes.map((n) => n.time));
  const minLane = Math.min(...notes.map((n) => n.lane));
  return {
    anchorTime,
    minLane,
    items: notes.map((n) => ({ dt: n.time - anchorTime, lane: n.lane, type: n.type, dur: n.dur })),
  };
}

/**
 * クリップボードを time(と任意で laneOffset)基準で展開。
 * targetLane を渡すと最小レーンが targetLane に来るよう平行移動。
 */
export function pasteNotes(
  clip: Clipboard,
  time: number,
  keyCount: number,
  targetLane?: number,
): Note[] {
  const laneShift = targetLane === undefined ? 0 : targetLane - clip.minLane;
  return clip.items.map((it) => ({
    time: Math.max(0, Math.round(time + it.dt)),
    lane: clampLane(it.lane + laneShift, keyCount),
    type: it.type,
    dur: it.dur,
  }));
}

export interface TimeRange {
  start: number;
  end: number;
}

/** 時間・レーン矩形に入るノーツを抽出 (start/end は time、loLane/hiLane は包含)。 */
export function notesInRect(
  notes: Note[],
  range: TimeRange,
  loLane: number,
  hiLane: number,
): Note[] {
  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  const lLane = Math.min(loLane, hiLane);
  const hLane = Math.max(loLane, hiLane);
  return notes.filter(
    (n) => n.time >= lo && n.time <= hi && n.lane >= lLane && n.lane <= hLane,
  );
}
