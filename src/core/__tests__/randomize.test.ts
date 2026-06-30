import { describe, it, expect } from 'vitest';
import { randomizeLanes, NEUTRAL_BIAS } from '../randomize';
import { detectIssues } from '../normalize';
import type { Note } from '../types';

const tap = (time: number, lane: number): Note => ({ time, lane, type: 0, dur: 0 });
const ln = (time: number, lane: number, dur: number): Note => ({ time, lane, type: 1, dur });

// 4K の実現可能(同時押し ≤4)な代表譜面。LN・和音・連打を含む。
function sampleChart(): Note[] {
  const notes: Note[] = [];
  for (let i = 0; i < 40; i++) {
    const t = i * 120;
    notes.push(tap(t, i % 4));
    if (i % 5 === 0) notes.push(tap(t, (i + 2) % 4)); // 和音(2押し)
    if (i % 7 === 0) notes.push(ln(t, (i + 1) % 4, 300)); // LN
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  return notes;
}

describe('randomizeLanes', () => {
  it('ノーツ数・time・type・dur を保持しレーンのみ変える', () => {
    const notes = sampleChart();
    const out = randomizeLanes(notes, new Set(notes), { keyCount: 4 });
    expect(out.length).toBe(notes.length);
    out.forEach((n, i) => {
      expect(n.time).toBe(notes[i].time);
      expect(n.type).toBe(notes[i].type);
      expect(n.dur).toBe(notes[i].dur);
      expect(n.lane).toBeGreaterThanOrEqual(0);
      expect(n.lane).toBeLessThan(4);
    });
  });

  it('実現可能な譜面なら何度試しても重なりを生まない', () => {
    const notes = sampleChart();
    for (let trial = 0; trial < 50; trial++) {
      const out = randomizeLanes(notes, new Set(notes), { keyCount: 4 });
      const issues = detectIssues(out);
      expect(issues.duplicates).toBe(0);
      expect(issues.lnOverlaps).toBe(0);
    }
  });

  it('同時押しの和音は必ず別レーンへ分かれる', () => {
    const chord = [tap(1000, 0), tap(1000, 0), tap(1000, 0), tap(1000, 0)];
    const out = randomizeLanes(chord, new Set(chord), { keyCount: 4 });
    const lanes = new Set(out.map((n) => n.lane));
    expect(lanes.size).toBe(4); // 0..3 が1つずつ
  });

  it('選択(対象)のみ動かし、非対象はレーン据置・重なりも作らない', () => {
    const fixed1 = ln(1000, 0, 500); // 1000..1500 をレーン0で占有
    const t1 = tap(1200, 2); // fixed1 の期間中。レーン0には来てはいけない
    const fixed2 = tap(2000, 1);
    const t2 = tap(2000, 3); // fixed2 と同時。レーン1には来てはいけない
    // 入力は time 昇順 (同時刻は安定ソートで fixed2 → t2 の順)
    const notes = [fixed1, t1, fixed2, t2];
    const out = randomizeLanes(notes, new Set([t1, t2]), { keyCount: 4 });

    // 出力は入力と同順。非対象 (fixed1/fixed2) はレーン据置
    expect(out[0].lane).toBe(0); // fixed1
    expect(out[2].lane).toBe(1); // fixed2
    // 対象は禁止レーンを避けている
    expect(out[1].lane).not.toBe(0); // t1 は LN(レーン0) の途中に来ない
    expect(out[3].lane).not.toBe(1); // t2 は fixed2(レーン1) と同時に来ない

    const issues = detectIssues(out);
    expect(issues.duplicates).toBe(0);
    expect(issues.lnOverlaps).toBe(0);
  });

  // 決定的なシード乱数 (テストを安定させる)
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 間隔 > guard の単発 tap 列 (毎回どのレーンも空いている状況)
  const spacedTaps = (n = 60): Note[] => Array.from({ length: n }, (_, i) => tap(i * 500, 0));

  // 同レーン連打(ジャック)の回数を数える
  function jackCount(notes: Note[]): number {
    let c = 0;
    for (let i = 1; i < notes.length; i++) if (notes[i].lane === notes[i - 1].lane) c++;
    return c;
  }

  function laneCounts(notes: Note[], keyCount: number): number[] {
    const c = new Array<number>(keyCount).fill(0);
    notes.forEach((n) => c[n.lane]++);
    return c;
  }

  it('jack を上げるとジャックが増え、下げると減る (同一乱数列で比較)', () => {
    const notes = spacedTaps();
    const high = randomizeLanes(notes, new Set(notes), {
      keyCount: 4,
      bias: { ...NEUTRAL_BIAS, jack: 1 },
      rng: mulberry32(42),
    });
    const low = randomizeLanes(notes, new Set(notes), {
      keyCount: 4,
      bias: { ...NEUTRAL_BIAS, jack: -1 },
      rng: mulberry32(42),
    });
    expect(jackCount(high)).toBeGreaterThan(jackCount(low));
  });

  it('balance を上げるとレーン使用が均等に寄る (偏りが減る)', () => {
    const notes = spacedTaps(200);
    const spread = (bias: number): number => {
      const c = laneCounts(
        randomizeLanes(notes, new Set(notes), {
          keyCount: 4,
          bias: { ...NEUTRAL_BIAS, balance: bias },
          rng: mulberry32(7),
        }),
        4,
      );
      return Math.max(...c) - Math.min(...c);
    };
    expect(spread(1)).toBeLessThanOrEqual(spread(0));
  });

  it('バイアスを掛けても重なりは生まず件数も保つ', () => {
    const notes = sampleChart();
    const out = randomizeLanes(notes, new Set(notes), {
      keyCount: 4,
      bias: { jack: 0.8, stream: 0.8, chordSpread: -0.8, balance: 0.5 },
    });
    expect(out.length).toBe(notes.length);
    const issues = detectIssues(out);
    expect(issues.duplicates).toBe(0);
    expect(issues.lnOverlaps).toBe(0);
  });

  it('rng 注入で決定的に最小/最大の空きレーンを選ぶ', () => {
    const notes = [tap(0, 0), tap(500, 0), tap(1000, 0)]; // 間隔 > guard
    const low = randomizeLanes(notes, new Set(notes), { keyCount: 4, rng: () => 0 });
    expect(low.every((n) => n.lane === 0)).toBe(true);
    const high = randomizeLanes(notes, new Set(notes), { keyCount: 4, rng: () => 0.999 });
    expect(high.every((n) => n.lane === 3)).toBe(true);
  });
});
