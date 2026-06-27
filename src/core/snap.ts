import type { Note, TimingInfo } from './types';

// 拍グリッド生成とスナップ。stepBeats は「1拍(4分)を 1.0」とした刻み幅。
//   全音符=4, 2分=2, 4分=1, 8分=0.5, 8分3連=1/3, 16分=0.25, 16分3連=1/6

export interface SnapDivision {
  label: string;
  stepBeats: number;
}

// stepBeats <= 0 は「フリー」(グリッドスナップ無し)。
export const SNAP_DIVISIONS: SnapDivision[] = [
  { label: 'フリー', stepBeats: 0 },
  { label: '全音符', stepBeats: 4 },
  { label: '2分', stepBeats: 2 },
  { label: '4分', stepBeats: 1 },
  { label: '8分', stepBeats: 0.5 },
  { label: '12分 (3連)', stepBeats: 1 / 3 },
  { label: '16分', stepBeats: 0.25 },
  { label: '24分', stepBeats: 1 / 6 },
  { label: '32分', stepBeats: 0.125 },
  { label: '48分', stepBeats: 1 / 12 },
];

export function beatMs(timing: TimingInfo): number {
  return 60000 / (timing.bpm || 120);
}

export function stepMs(timing: TimingInfo, stepBeats: number): number {
  return beatMs(timing) * stepBeats;
}

/** 最近傍のグリッド時刻へスナップ。 */
export function snapToGrid(time: number, timing: TimingInfo, stepBeats: number): number {
  const step = stepMs(timing, stepBeats);
  if (step <= 0) return time;
  const k = Math.round((time - timing.offsetMs) / step);
  return timing.offsetMs + k * step;
}

export type GridLineKind = 'measure' | 'beat' | 'sub';

export interface GridLine {
  time: number;
  kind: GridLineKind;
}

/**
 * [startMs, endMs] の範囲のグリッド線。4拍ごと=measure, 1拍ごと=beat, その他=sub。
 * beatsPerMeasure は将来拍子対応用 (既定 4)。
 */
export function gridLinesInRange(
  timing: TimingInfo,
  stepBeats: number,
  startMs: number,
  endMs: number,
  beatsPerMeasure = 4,
): GridLine[] {
  const step = stepMs(timing, stepBeats);
  const lines: GridLine[] = [];
  if (step <= 0) return lines;

  const beat = beatMs(timing);
  const measure = beat * beatsPerMeasure;
  const eps = 1e-6;

  const kStart = Math.ceil((startMs - timing.offsetMs) / step);
  const kEnd = Math.floor((endMs - timing.offsetMs) / step);

  for (let k = kStart; k <= kEnd; k++) {
    const time = timing.offsetMs + k * step;
    const fromOffset = time - timing.offsetMs;
    let kind: GridLineKind = 'sub';
    if (Math.abs(fromOffset % measure) < eps || Math.abs((fromOffset % measure) - measure) < eps) {
      kind = 'measure';
    } else if (Math.abs(fromOffset % beat) < eps || Math.abs((fromOffset % beat) - beat) < eps) {
      kind = 'beat';
    }
    lines.push({ time, kind });
  }
  return lines;
}

/** 既存ノーツの時刻のうち threshold 以内で最も近いものを返す (なければ null)。 */
export function nearestNoteTime(time: number, notes: Note[], thresholdMs: number): number | null {
  let best: number | null = null;
  let bestDist = thresholdMs;
  // notes は time 昇順前提だが、簡潔さのため線形 (描画範囲のみ渡す想定)。
  for (const n of notes) {
    const d = Math.abs(n.time - time);
    if (d <= bestDist) {
      bestDist = d;
      best = n.time;
    }
  }
  return best;
}

/**
 * グリッドと既存ノーツの両方を考慮した最近傍スナップ。
 * noteSnapNotes を渡すと、グリッドより近い既存ノーツがあればそちらへ吸着。
 */
export function snapTime(
  time: number,
  timing: TimingInfo,
  stepBeats: number,
  noteSnapNotes?: Note[],
  noteThresholdMs = 30,
): number {
  const grid = snapToGrid(time, timing, stepBeats);
  if (!noteSnapNotes || noteSnapNotes.length === 0) return grid;
  const near = nearestNoteTime(time, noteSnapNotes, noteThresholdMs);
  if (near === null) return grid;
  return Math.abs(near - time) <= Math.abs(grid - time) ? near : grid;
}
