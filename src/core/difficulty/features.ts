import type { Note } from '../types';
import { noteEnd } from '../types';

// 各ノーツの局所的な難度寄与 (sorted notes と同じ index に対応)。
// すべて O(n)〜O(n log n)。これらを時間窓で合算して strain 系列を作る (analyze.ts)。

export interface NoteContribs {
  jack: number[];
  trill: number[];
  chord: number[];
  ln: number[];
  movement: number[];
  rhythm: number[];
}

function jackScore(gap: number): number {
  if (gap <= 90) return 4;
  if (gap <= 120) return 3;
  if (gap <= 180) return 2;
  if (gap <= 250) return 1;
  return 0;
}

function lowerBound(notes: Note[], time: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function computeContribs(notes: Note[]): NoteContribs {
  const n = notes.length;
  const jack = new Array<number>(n).fill(0);
  const trill = new Array<number>(n).fill(0);
  const chord = new Array<number>(n).fill(0);
  const ln = new Array<number>(n).fill(0);
  const movement = new Array<number>(n).fill(0);
  const rhythm = new Array<number>(n).fill(0);

  // jack: 同一レーン連打の近接度
  const lastByLane = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const prev = lastByLane.get(notes[i].lane);
    if (prev !== undefined) jack[i] = jackScore(notes[i].time - prev);
    lastByLane.set(notes[i].lane, notes[i].time);
  }

  // trill: A-B-A 交互 + 安定間隔
  for (let i = 2; i < n; i++) {
    const a = notes[i - 2];
    const b = notes[i - 1];
    const c = notes[i];
    if (a.lane !== c.lane || a.lane === b.lane) continue;
    const i1 = b.time - a.time;
    const i2 = c.time - b.time;
    if (Math.abs(i1 - i2) > 40) continue;
    if (i2 <= 120) trill[i] = 3;
    else if (i2 <= 180) trill[i] = 2;
    else if (i2 <= 250) trill[i] = 1;
  }

  // chord: 時間近接クラスタリング (固定バケット丸めではなく境界漏れを防ぐ)
  const tol = 25;
  let i = 0;
  while (i < n) {
    let j = i + 1;
    const anchor = notes[i].time;
    while (j < n && notes[j].time - anchor <= tol) j++;
    const lanes = new Set<number>();
    for (let k = i; k < j; k++) lanes.add(notes[k].lane);
    const size = lanes.size;
    let weight = 0;
    if (size === 2) weight = 1;
    else if (size === 3) weight = 4;
    else if (size >= 4) weight = 8;
    if (weight > 0) {
      const share = weight / (j - i);
      for (let k = i; k < j; k++) chord[k] += share;
    }
    i = j;
  }

  // ln: ホールド長 + ホールド中の別レーン tap 圧
  for (let k = 0; k < n; k++) {
    if (notes[k].type !== 1) continue;
    const start = notes[k].time;
    const end = noteEnd(notes[k]);
    const len = end - start;
    let s = 0;
    if (len >= 500) s += 1;
    if (len >= 1000) s += 2;
    if (len >= 2000) s += 3;
    let overlap = 0;
    let p = lowerBound(notes, start);
    while (p < n && notes[p].time < end) {
      if (p !== k && notes[p].time > start && notes[p].lane !== notes[k].lane) overlap++;
      p++;
    }
    ln[k] = s + overlap * 1.5;
  }

  // movement: 短間隔でのレーン跳躍
  for (let k = 1; k < n; k++) {
    const dist = Math.abs(notes[k].lane - notes[k - 1].lane);
    if (dist === 0) continue;
    const interval = notes[k].time - notes[k - 1].time;
    let mult = 1;
    if (interval <= 120) mult = 2.5;
    else if (interval <= 180) mult = 2.0;
    else if (interval <= 250) mult = 1.5;
    movement[k] = dist * mult;
  }

  // rhythm: 直近間隔が変化する箇所 (リズムの不規則さ)
  for (let k = 2; k < n; k++) {
    const prevInterval = notes[k - 1].time - notes[k - 2].time;
    const interval = notes[k].time - notes[k - 1].time;
    if (interval > 0 && interval < 1000 && prevInterval > 0 && prevInterval < 1000) {
      if (Math.abs(interval - prevInterval) > 15) rhythm[k] = 1;
    }
  }

  return { jack, trill, chord, ln, movement, rhythm };
}
