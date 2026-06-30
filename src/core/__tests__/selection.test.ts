import { describe, it, expect } from 'vitest';
import type { Note } from '../types';
import {
  applyEdgeMove,
  combineEdge,
  notesInRectWithEdges,
  translateNotesWithEdges,
  type Edge,
} from '../selection';

const tap = (time: number, lane: number): Note => ({ time, lane, type: 0, dur: 0 });
const ln = (time: number, lane: number, dur: number): Note => ({ time, lane, type: 1, dur });

describe('applyEdgeMove', () => {
  it('both: ノーツ全体を時間・レーン平行移動 (dur 不変)', () => {
    const r = applyEdgeMove(ln(1000, 1, 500), 'both', 250, 1, 4);
    expect(r).toEqual({ time: 1250, lane: 2, type: 1, dur: 500 });
  });

  it('head: 始点のみ移動し終点は固定 (レーン不変)', () => {
    // 終点 = 1500 固定。始点 1000 -> 1200 で dur 300
    const r = applyEdgeMove(ln(1000, 1, 500), 'head', 200, 1, 4);
    expect(r).toEqual({ time: 1200, lane: 1, type: 1, dur: 300 });
    expect(r.time + r.dur).toBe(1500); // 終点不変
  });

  it('tail: 終点のみ移動し始点は固定 (レーン不変)', () => {
    const r = applyEdgeMove(ln(1000, 1, 500), 'tail', 200, 1, 4);
    expect(r).toEqual({ time: 1000, lane: 1, type: 1, dur: 700 });
  });

  it('head が終点を越えても dur>=0 にクランプ', () => {
    const r = applyEdgeMove(ln(1000, 1, 500), 'head', 999, 0, 4);
    expect(r.time).toBe(1500);
    expect(r.dur).toBe(0);
  });

  it('tail が始点を越えても dur>=0 にクランプ', () => {
    const r = applyEdgeMove(ln(1000, 1, 500), 'tail', -999, 0, 4);
    expect(r.time).toBe(1000);
    expect(r.dur).toBe(0);
  });

  it('tap は edge 指定に関わらず全体移動扱い', () => {
    const r = applyEdgeMove(tap(1000, 0), 'head', 200, 1, 4);
    expect(r).toEqual({ time: 1200, lane: 1, type: 0, dur: 0 });
  });
});

describe('combineEdge', () => {
  it('head ∪ tail = both', () => {
    expect(combineEdge('head', 'tail')).toBe('both');
  });
  it('同じ端同士は維持', () => {
    expect(combineEdge('head', 'head')).toBe('head');
  });
  it('both が含まれれば both', () => {
    expect(combineEdge('both', 'head')).toBe('both');
    expect(combineEdge('tail', 'both')).toBe('both');
  });
});

describe('notesInRectWithEdges', () => {
  // LN: time=1000, dur=500 → 終点 1500
  const notes = [ln(1000, 1, 500)];

  it('始点だけ囲むと head', () => {
    const { notes: found, edges } = notesInRectWithEdges(notes, { start: 900, end: 1100 }, 0, 3);
    expect(found).toHaveLength(1);
    expect(edges.get(found[0])).toBe('head');
  });

  it('終点だけ囲むと tail', () => {
    const { edges, notes: found } = notesInRectWithEdges(notes, { start: 1400, end: 1600 }, 0, 3);
    expect(edges.get(found[0])).toBe('tail');
  });

  it('両端を囲むと both (edges は省略)', () => {
    const { notes: found, edges } = notesInRectWithEdges(notes, { start: 900, end: 1600 }, 0, 3);
    expect(found).toHaveLength(1);
    expect(edges.has(found[0])).toBe(false);
  });

  it('本体だけ貫くと非選択 (端に触れない)', () => {
    const { notes: found } = notesInRectWithEdges(notes, { start: 1150, end: 1350 }, 0, 3);
    expect(found).toHaveLength(0);
  });

  it('レーン範囲外は非選択', () => {
    const { notes: found } = notesInRectWithEdges(notes, { start: 900, end: 1600 }, 2, 3);
    expect(found).toHaveLength(0);
  });

  it('tap は time 範囲内なら both', () => {
    const { notes: found, edges } = notesInRectWithEdges([tap(1000, 0)], { start: 900, end: 1100 }, 0, 3);
    expect(found).toHaveLength(1);
    expect(edges.has(found[0])).toBe(false);
  });
});

describe('translateNotesWithEdges', () => {
  it('端マップに従い個別にリサイズ/移動', () => {
    const a = ln(1000, 0, 500); // head 選択 → 始点移動
    const b = ln(2000, 1, 500); // 未登録 → both 扱いで全体移動
    const edges = new Map<Note, Edge>([[a, 'head']]);
    const [ra, rb] = translateNotesWithEdges([a, b], edges, 100, 0, 4);
    expect(ra).toEqual({ time: 1100, lane: 0, type: 1, dur: 400 }); // 終点 1500 固定
    expect(rb).toEqual({ time: 2100, lane: 1, type: 1, dur: 500 }); // 全体移動
  });
});
