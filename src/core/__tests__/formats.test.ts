import { describe, it, expect } from 'vitest';
import { osuToChart, serializeOsu, parseOsu } from '../formats/osu';
import { serializeTxt, parseTxt } from '../formats/txt';
import { chartId } from '../hash';
import type { Note } from '../types';

// 最小の osu! mania 4K フィクスチャ (x=64/192/320/448 -> lane 0..3、type 128=long)。
const OSU_4K = `osu file format v14

[General]
AudioFilename: test.mp3
Mode: 3

[Metadata]
Title:Test
Artist:tester
Creator:c
Version:v

[Difficulty]
CircleSize:4

[TimingPoints]
0,300,4,2,0,100,1,0

[HitObjects]
64,192,0,1,0,0:0:0:0:
192,192,250,1,0,0:0:0:0:
320,192,500,1,0,0:0:0:0:
448,192,500,1,0,0:0:0:0:
64,192,750,128,0,1250:0:0:0:0:
320,192,1000,1,0,0:0:0:0:
`;

describe('osu parser', () => {
  it('parses mania 4K with expected note count', () => {
    const r = parseOsu(OSU_4K);
    expect(r.keyCount).toBe(4);
    expect(r.notes.length).toBe(6);
  });

  it('derives bpm/offset from TimingPoints', () => {
    const r = parseOsu(OSU_4K);
    expect(r.timing.offsetMs).toBe(0);
    expect(r.timing.bpm).toBeCloseTo(200, 5); // 60000 / 300
  });

  it('lanes are within 0..keyCount-1', () => {
    const r = parseOsu(OSU_4K);
    for (const n of r.notes) {
      expect(n.lane).toBeGreaterThanOrEqual(0);
      expect(n.lane).toBeLessThan(r.keyCount);
    }
  });

  it('notes are time-sorted', () => {
    const r = parseOsu(OSU_4K);
    for (let i = 1; i < r.notes.length; i++) {
      expect(r.notes[i].time).toBeGreaterThanOrEqual(r.notes[i - 1].time);
    }
  });

  it('detects the long note with positive duration', () => {
    const r = parseOsu(OSU_4K);
    const longs = r.notes.filter((n) => n.type === 1);
    expect(longs.length).toBe(1);
    expect(longs[0].dur).toBe(500); // 1250 - 750
  });

  it('round-trips osu -> chart -> osu (time/lane/type preserved)', () => {
    const chart = osuToChart(OSU_4K, 'fixture');
    const reparsed = parseOsu(serializeOsu(chart));
    expect(reparsed.notes.length).toBe(chart.notes.length);
    expect(reparsed.keyCount).toBe(chart.keyCount);
    for (let i = 0; i < chart.notes.length; i++) {
      expect(reparsed.notes[i].lane).toBe(chart.notes[i].lane);
      expect(reparsed.notes[i].time).toBe(chart.notes[i].time);
      expect(reparsed.notes[i].type).toBe(chart.notes[i].type);
    }
  });
});

describe('txt format', () => {
  const notes: Note[] = [
    { time: 1000, lane: 0, type: 0, dur: 0 },
    { time: 1000, lane: 2, type: 0, dur: 0 },
    { time: 1500, lane: 1, type: 1, dur: 500 },
    { time: 2000, lane: 3, type: 0, dur: 0 },
  ];

  it('round-trips chart -> txt -> chart', () => {
    const id = chartId(notes);
    const chart = {
      id,
      name: 't',
      format: 'txt' as const,
      keyCount: 4,
      notes,
      timing: { offsetMs: 0, bpm: 120 },
      difficulty: undefined,
    };
    const txt = serializeTxt(chart);
    expect(txt).toContain(`${id},`);
    expect(txt).toContain(':');

    const r = parseTxt(txt);
    expect(r.id).toBe(id);
    expect(r.notes).toEqual(notes);
    expect(r.keyCount).toBe(4);
  });

  it('parses header difficulty value', () => {
    const r = parseTxt('abcdef0123456789,12.5:1000,0,0/2000,1,1,300');
    expect(r.id).toBe('abcdef0123456789');
    expect(r.difficulty).toBe(12.5);
    expect(r.notes.length).toBe(2);
    expect(r.notes[1]).toEqual({ time: 2000, lane: 1, type: 1, dur: 300 });
  });

  it('tolerates missing header', () => {
    const r = parseTxt('1000,0,0/1200,1,0');
    expect(r.notes.length).toBe(2);
  });
});

describe('cross-format id stability', () => {
  it('same notes produce same id across osu/txt', () => {
    const osu = osuToChart(OSU_4K, 'fixture');
    const back = parseTxt(serializeTxt(osu));
    expect(chartId(back.notes)).toBe(osu.id);
  });
});
