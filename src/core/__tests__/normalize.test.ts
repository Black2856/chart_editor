import { describe, it, expect } from 'vitest';
import { normalizeChart, detectIssues } from '../normalize';
import type { Note } from '../types';

const tap = (time: number, lane: number): Note => ({ time, lane, type: 0, dur: 0 });
const ln = (time: number, lane: number, dur: number): Note => ({ time, lane, type: 1, dur });

describe('detectIssues', () => {
  it('LN期間中の同レーン単ノーツを①として検出', () => {
    const notes = [ln(1000, 0, 500), tap(1200, 0)]; // 1000..1500 の途中 1200 に tap
    const r = detectIssues(notes);
    expect(r.lnOverlaps).toBe(1);
    expect(r.duplicates).toBe(0);
  });

  it('別レーンのノーツは①にならない', () => {
    const notes = [ln(1000, 0, 500), tap(1200, 1)];
    expect(detectIssues(notes).lnOverlaps).toBe(0);
  });

  it('LN終了ちょうどの同レーン tap は誤検出しない', () => {
    const notes = [ln(1000, 0, 500), tap(1500, 0)];
    expect(detectIssues(notes).lnOverlaps).toBe(0);
  });

  it('同レーンほぼ同時を②として検出', () => {
    const notes = [tap(1000, 0), tap(1010, 0)]; // 10ms 差 < 30ms
    const r = detectIssues(notes);
    expect(r.duplicates).toBe(1);
    expect(r.lnOverlaps).toBe(0);
  });

  it('閾値を超える間隔は②にならない', () => {
    const notes = [tap(1000, 0), tap(1100, 0)];
    expect(detectIssues(notes).duplicates).toBe(0);
  });

  it('正常な譜面は問題ゼロ', () => {
    const notes = [tap(1000, 0), tap(1000, 1), ln(1200, 2, 400), tap(1700, 0)];
    expect(detectIssues(notes)).toEqual({ duplicates: 0, lnOverlaps: 0 });
  });
});

describe('normalizeChart - delete', () => {
  it('① を削除すると LN だけ残る', () => {
    const notes = [ln(1000, 0, 500), tap(1200, 0)];
    const r = normalizeChart(notes, { lnOverlap: 'delete', duplicate: 'delete', keyCount: 4 });
    expect(r.notes).toEqual([ln(1000, 0, 500)]);
    expect(r.report.lnOverlaps).toBe(1);
    expect(r.report.removed).toBe(1);
    expect(r.report.moved).toBe(0);
  });

  it('② を削除すると 1 つだけ残る (LN優先で残す)', () => {
    const notes = [tap(1000, 0), ln(1005, 0, 300)];
    const r = normalizeChart(notes, { lnOverlap: 'delete', duplicate: 'delete', keyCount: 4 });
    expect(r.notes).toEqual([ln(1005, 0, 300)]);
    expect(r.report.duplicates).toBe(1);
    expect(r.report.removed).toBe(1);
  });

  it('①②の解決方法を別々に指定できる', () => {
    // lane0: 1000 と 1010 が②、LN 2000..2500 中の 2200 が①
    const notes = [tap(1000, 0), tap(1010, 0), ln(2000, 0, 500), tap(2200, 0)];
    const r = normalizeChart(notes, { lnOverlap: 'delete', duplicate: 'move', keyCount: 4 });
    expect(r.report.duplicates).toBe(1);
    expect(r.report.lnOverlaps).toBe(1);
    expect(r.report.moved).toBe(1); // ② を移動
    expect(r.report.removed).toBe(1); // ① を削除
  });
});

describe('normalizeChart - move', () => {
  it('① を別レーンへ退避し、衝突しない位置に移る', () => {
    const notes = [ln(1000, 0, 500), tap(1200, 0)];
    const r = normalizeChart(notes, { lnOverlap: 'move', duplicate: 'move', keyCount: 4 });
    expect(r.report.moved).toBe(1);
    expect(r.report.removed).toBe(0);
    expect(r.notes.length).toBe(2);
    const moved = r.notes.find((n) => n.type === 0)!;
    expect(moved.lane).not.toBe(0); // 別レーンへ
    expect(moved.time).toBe(1200); // 時刻は保持
  });

  it('退避先が無ければ削除にフォールバック (keyCount=1)', () => {
    const notes = [ln(1000, 0, 500), tap(1200, 0)];
    const r = normalizeChart(notes, { lnOverlap: 'move', duplicate: 'move', keyCount: 1 });
    expect(r.report.moved).toBe(0);
    expect(r.report.removed).toBe(1);
    expect(r.notes).toEqual([ln(1000, 0, 500)]);
  });

  it('移動先も埋まっていれば衝突しないレーンを探す', () => {
    // lane0 に LN、lane1 にも同時刻 tap → lane2 以降へ退避
    const notes = [ln(1000, 0, 500), tap(1200, 1), tap(1200, 0)];
    const r = normalizeChart(notes, { lnOverlap: 'move', duplicate: 'move', keyCount: 4 });
    const movedFrom0 = r.notes.find((n) => n.type === 0 && n.time === 1200 && n.lane !== 1)!;
    expect(movedFrom0.lane).toBeGreaterThanOrEqual(2);
  });
});

describe('normalizeChart - 不変条件', () => {
  it('結果は time 昇順', () => {
    const notes = [tap(1000, 0), tap(1010, 0), ln(2000, 0, 500), tap(2200, 0), tap(500, 1)];
    const r = normalizeChart(notes, { lnOverlap: 'move', duplicate: 'move', keyCount: 6 });
    for (let i = 1; i < r.notes.length; i++) {
      expect(r.notes[i].time).toBeGreaterThanOrEqual(r.notes[i - 1].time);
    }
  });

  it('入力配列を破壊しない', () => {
    const notes = [ln(1000, 0, 500), tap(1200, 0)];
    const snapshot = JSON.parse(JSON.stringify(notes));
    normalizeChart(notes, { lnOverlap: 'delete', duplicate: 'delete', keyCount: 4 });
    expect(notes).toEqual(snapshot);
  });
});
