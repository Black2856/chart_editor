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

// --- LN 端単位の選択・移動 ---
// 'head'=始点のみ / 'tail'=終点のみ / 'both'=ノーツ全体。tap は常に 'both'。
export type Edge = 'head' | 'tail' | 'both';

/** 2 つの端選択を合成 (例: head ∪ tail = both)。 */
export function combineEdge(a: Edge, b: Edge): Edge {
  if (a === 'both' || b === 'both') return 'both';
  return a === b ? a : 'both';
}

/**
 * 1 ノーツへ端指定つきで移動/リサイズを適用。
 * - tap / 'both': 時間+レーンを平行移動 (dur 不変)。
 * - 'head': 始点のみ dt 移動。終点(time+dur)は固定 → 長さが変化。レーンは不変。
 * - 'tail': 終点のみ dt 移動。始点は固定。レーンは不変。
 * 端移動では始点と終点が交差しないよう dur>=0 にクランプ。
 */
export function applyEdgeMove(
  n: Note,
  edge: Edge,
  deltaTime: number,
  deltaLane: number,
  keyCount: number,
): Note {
  if (n.type === 0 || edge === 'both') {
    return {
      time: Math.max(0, Math.round(n.time + deltaTime)),
      lane: clampLane(n.lane + deltaLane, keyCount),
      type: n.type,
      dur: n.dur,
    };
  }
  const tail = n.time + n.dur;
  if (edge === 'head') {
    const newHead = Math.min(Math.max(0, Math.round(n.time + deltaTime)), tail);
    return { time: newHead, lane: n.lane, type: 1, dur: tail - newHead };
  }
  // tail
  const newTail = Math.max(Math.round(tail + deltaTime), n.time);
  return { time: n.time, lane: n.lane, type: 1, dur: newTail - n.time };
}

/** 端指定マップ (未登録は 'both') つきで選択ノーツを移動/リサイズ。 */
export function translateNotesWithEdges(
  notes: Note[],
  edges: Map<Note, Edge>,
  deltaTime: number,
  deltaLane: number,
  keyCount: number,
): Note[] {
  return notes.map((n) => applyEdgeMove(n, edges.get(n) ?? 'both', deltaTime, deltaLane, keyCount));
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

export interface RectSelection {
  notes: Note[];
  edges: Map<Note, Edge>; // 'both' は省略 (既定)
}

/**
 * 矩形に入るノーツを端単位で抽出。
 * - tap: time が範囲内なら 'both'。
 * - LN: 始点のみ範囲内→'head' / 終点のみ→'tail' / 両端→'both' / どちらも外→非選択。
 *   (本体だけが矩形を貫くケースは端に触れていないので選択しない)
 */
export function notesInRectWithEdges(
  notes: Note[],
  range: TimeRange,
  loLane: number,
  hiLane: number,
): RectSelection {
  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  const lLane = Math.min(loLane, hiLane);
  const hLane = Math.max(loLane, hiLane);
  const out: Note[] = [];
  const edges = new Map<Note, Edge>();
  for (const n of notes) {
    if (n.lane < lLane || n.lane > hLane) continue;
    if (n.type === 0) {
      if (n.time >= lo && n.time <= hi) out.push(n);
      continue;
    }
    const headIn = n.time >= lo && n.time <= hi;
    const tailIn = n.time + n.dur >= lo && n.time + n.dur <= hi;
    if (!headIn && !tailIn) continue;
    out.push(n);
    const edge: Edge = headIn && tailIn ? 'both' : headIn ? 'head' : 'tail';
    if (edge !== 'both') edges.set(n, edge);
  }
  return { notes: out, edges };
}
