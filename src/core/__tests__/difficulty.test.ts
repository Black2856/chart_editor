import { describe, it, expect } from 'vitest';
import { analyzeChart } from '../difficulty/analyze';
import type { Note } from '../types';

// 一定間隔 nps の tap 列を生成 (lane を順に回す)
function steady(nps: number, seconds: number, keyCount = 4): Note[] {
  const notes: Note[] = [];
  const step = 1000 / nps;
  const count = Math.floor(nps * seconds);
  for (let i = 0; i < count; i++) {
    notes.push({ time: Math.round(i * step), lane: i % keyCount, type: 0, dur: 0 });
  }
  return notes;
}

describe('difficulty', () => {
  it('empty chart -> star 0', () => {
    const r = analyzeChart([]);
    expect(r.star).toBe(0);
    expect(r.overall).toBe(0);
  });

  it('denser charts score higher', () => {
    const easy = analyzeChart(steady(2, 30));
    const hard = analyzeChart(steady(12, 30));
    expect(hard.overall).toBeGreaterThan(easy.overall);
    expect(hard.star).toBeGreaterThanOrEqual(easy.star);
  });

  it('rest sections do not drag difficulty down', () => {
    // 高密度 5 秒
    const burst = steady(12, 5);
    // 同じ 5 秒 + その後 120 秒の休憩 (ノーツ無し)。最後に1ノーツだけ置いて尺を伸ばす。
    const withRest: Note[] = [...burst, { time: 125000, lane: 0, type: 0, dur: 0 }];
    const a = analyzeChart(burst);
    const b = analyzeChart(withRest);
    // 休憩で薄まらず、overall はほぼ同等 (10% 以内)
    expect(Math.abs(a.overall - b.overall) / a.overall).toBeLessThan(0.1);
  });

  it('star is overall / 3 to 1 decimal', () => {
    const r = analyzeChart(steady(10, 20));
    expect(r.star).toBeCloseTo(Math.round((r.overall / 3) * 10) / 10, 5);
    expect(r.stats.totalNotes).toBe(200);
  });

  it('dense chart gets a clearly positive rating', () => {
    const r = analyzeChart(steady(14, 30));
    expect(r.star).toBeGreaterThan(2);
    expect(r.stats.maxNps).toBeGreaterThan(10);
  });
});
