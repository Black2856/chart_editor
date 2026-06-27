import type { DifficultyResult, Note } from '../types';
import { computeContribs } from './features';

// strain ベースの難易度算出。
// 1) 固定ホップで時間窓を滑らせ、各窓のローカル強度 (毎秒換算レート) を出す。
// 2) 休憩に引っ張られないよう、強度系列を降順ソートしてピーク加重平均で集約 (長さ非依存・休憩ロバスト)。

const HOP = 100; // ms 窓のステップ
const WINDOW = 1000; // ms 窓幅
const DECAY = 0.98; // ピーク加重の減衰 (小さいほど上位ピークのみ重視)
const STAR_DIV = 3; // star = overall / STAR_DIV (小数第1位)

// 各特徴の重み (毎秒レートに対して)。movement は値域が大きいので控えめに。
const W = {
  density: 1.0,
  jack: 0.5,
  trill: 0.4,
  chord: 0.8,
  ln: 0.6,
  movement: 0.22,
  rhythm: 0.5,
};

function round(v: number, digits = 2): number {
  const p = Math.pow(10, digits);
  return Math.round(v * p) / p;
}

/** 降順ソート後のピーク加重平均。休憩 (低値) は下位に来て寄与が小さい。長さ非依存で有界。 */
function peakAggregate(values: number[], decay = DECAY): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  let sum = 0;
  let w = 1;
  for (const v of sorted) {
    sum += v * w;
    w *= decay;
    if (w < 1e-4) break;
  }
  return sum * (1 - decay); // 重み総和 1/(1-decay) で正規化 -> 上位窓の加重平均
}

interface WindowSeries {
  strain: number[];
  density: number[];
  jack: number[];
  trill: number[];
  chord: number[];
  ln: number[];
  movement: number[];
  rhythm: number[];
  maxDensity: number;
}

function buildSeries(notes: Note[]): WindowSeries {
  const c = computeContribs(notes);
  const n = notes.length;
  const wsec = WINDOW / 1000;

  const firstTime = notes[0].time;
  const lastTime = notes[n - 1].time;

  const series: WindowSeries = {
    strain: [],
    density: [],
    jack: [],
    trill: [],
    chord: [],
    ln: [],
    movement: [],
    rhythm: [],
    maxDensity: 0,
  };

  // 二ポインタで窓内の合計を増分更新 (O(n + windows))
  let left = 0;
  let right = 0;
  let cnt = 0;
  let sJack = 0;
  let sTrill = 0;
  let sChord = 0;
  let sLn = 0;
  let sMove = 0;
  let sRhythm = 0;

  for (let te = firstTime; te <= lastTime + 1e-6; te += HOP) {
    const winStart = te - WINDOW;
    while (right < n && notes[right].time <= te) {
      cnt++;
      sJack += c.jack[right];
      sTrill += c.trill[right];
      sChord += c.chord[right];
      sLn += c.ln[right];
      sMove += c.movement[right];
      sRhythm += c.rhythm[right];
      right++;
    }
    while (left < right && notes[left].time <= winStart) {
      cnt--;
      sJack -= c.jack[left];
      sTrill -= c.trill[left];
      sChord -= c.chord[left];
      sLn -= c.ln[left];
      sMove -= c.movement[left];
      sRhythm -= c.rhythm[left];
      left++;
    }

    const density = cnt / wsec;
    const jack = sJack / wsec;
    const trill = sTrill / wsec;
    const chord = sChord / wsec;
    const ln = sLn / wsec;
    const movement = sMove / wsec;
    const rhythm = sRhythm / wsec;

    const strain =
      W.density * density +
      W.jack * jack +
      W.trill * trill +
      W.chord * chord +
      W.ln * ln +
      W.movement * movement +
      W.rhythm * rhythm;

    series.strain.push(strain);
    series.density.push(density);
    series.jack.push(jack);
    series.trill.push(trill);
    series.chord.push(chord);
    series.ln.push(ln);
    series.movement.push(movement);
    series.rhythm.push(rhythm);
    if (density > series.maxDensity) series.maxDensity = density;
  }

  return series;
}

export function emptyResult(): DifficultyResult {
  return {
    overall: 0,
    star: 0,
    stats: { totalNotes: 0, durationSec: 0, avgNps: 0, maxNps: 0, peakNps: 0 },
    difficulty: { density: 0, jack: 0, trill: 0, chord: 0, ln: 0, movement: 0, rhythm: 0 },
  };
}

export function analyzeChart(notes: Note[]): DifficultyResult {
  if (!notes || notes.length === 0) return emptyResult();

  const series = buildSeries(notes);
  const firstTime = notes[0].time;
  const lastTime = notes[notes.length - 1].time;
  const durationSec = Math.max((lastTime - firstTime) / 1000, 1);

  const overall = peakAggregate(series.strain);
  const star = round(overall / STAR_DIV, 1);

  return {
    overall: round(overall),
    star,
    stats: {
      totalNotes: notes.length,
      durationSec: round(durationSec),
      avgNps: round(notes.length / durationSec),
      maxNps: round(series.maxDensity),
      peakNps: round(peakAggregate(series.density)),
    },
    difficulty: {
      density: round(peakAggregate(series.density)),
      jack: round(peakAggregate(series.jack)),
      trill: round(peakAggregate(series.trill)),
      chord: round(peakAggregate(series.chord)),
      ln: round(peakAggregate(series.ln)),
      movement: round(peakAggregate(series.movement)),
      rhythm: round(peakAggregate(series.rhythm)),
    },
  };
}
