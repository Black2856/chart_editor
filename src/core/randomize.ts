// 既存ノーツのレーンをランダムに再配置する (FW非依存・テスト対象)。
// 方針: ノーツ数は保持(削除しない)・重なりを避ける・非対象ノーツは固定障害物として扱う。
// 重なり = 同レーンでの近接(taps が guardMs 以内) / LN への被り / 終端接触。
// 物理的に収まらない(元から不可能配置)場合のみ最も早く空くレーンへ置き、数だけは保つ。
//
// パターンバイアス: 空きレーンの中から「重み付き抽選」で選ぶことで、生成傾向を指定パターンへ寄せる。
//   jack        同レーン連打 (前の時刻と同じレーン)        -避ける / +増やす
//   stream      隣接レーンへの流れ (階段・ストリーム)       +強める
//   chordSpread 同時押しの広がり                          -密(隣接) / +広
//   balance     レーン使用の均等化 (使ったレーンを減点)     0..1 散らす強さ
// すべて 0 (NEUTRAL_BIAS) なら重みが均一になり、純粋な一様ランダムと一致する。

import type { Note } from './types';
import { noteEnd } from './types';
import { DEFAULT_DUP_THRESHOLD_MS } from './normalize';

export interface PatternBias {
  jack: number; // -1..1
  stream: number; // -1..1
  chordSpread: number; // -1..1
  balance: number; // 0..1
}

export const NEUTRAL_BIAS: PatternBias = { jack: 0, stream: 0, chordSpread: 0, balance: 0 };

export interface RandomizeOptions {
  keyCount: number;
  bias?: PatternBias; // 既定 NEUTRAL_BIAS (一様)
  guardMs?: number; // 同レーン近接の最小間隔。既定 DEFAULT_DUP_THRESHOLD_MS
  rng?: () => number; // [0,1) を返す乱数。テスト用に注入可。既定 Math.random
}

interface Interval {
  start: number;
  end: number;
}

// バイアス係数 (スライダー値 → 指数の重み)。距離や回数に掛けるため項ごとに倍率が異なる。
const C_JACK = 2.5;
const C_STREAM = 2.5;
const C_CHORD = 1.2;
const C_BALANCE = 1.5;
const EXP_CLAMP = 8; // exp の発散防止

function clampLane(lane: number, keyCount: number): number {
  if (lane < 0) return 0;
  if (lane >= keyCount) return keyCount - 1;
  return lane;
}

// 占有区間中で最も早く空く(max end が最小の)レーン。収まらない時のフォールバック。
function earliestLane(occ: Interval[][], keyCount: number): number {
  let best = 0;
  let bestEnd = Infinity;
  for (let l = 0; l < keyCount; l++) {
    let maxEnd = -Infinity;
    for (const iv of occ[l]) if (iv.end > maxEnd) maxEnd = iv.end;
    if (maxEnd < bestEnd) {
      bestEnd = maxEnd;
      best = l;
    }
  }
  return best;
}

function minDist(lane: number, lanes: number[]): number {
  let d = Infinity;
  for (const c of lanes) {
    const dd = Math.abs(lane - c);
    if (dd < d) d = dd;
  }
  return d === Infinity ? 0 : d;
}

/**
 * targets に含まれるノーツのレーンを、重なりを避けつつ (バイアスに従い) 再配置する。
 * 非対象ノーツはレーン据置で固定障害物となる。返り値は入力と同じ順序・同じ件数の新しい配列
 * (対象はレーン差し替え、非対象はコピー)。入力 notes は time 昇順であること。
 */
export function randomizeLanes(
  notes: Note[],
  targets: Set<Note>,
  options: RandomizeOptions,
): Note[] {
  const { keyCount } = options;
  const guard = options.guardMs ?? DEFAULT_DUP_THRESHOLD_MS;
  const rng = options.rng ?? Math.random;
  const bias = options.bias ?? NEUTRAL_BIAS;

  // レーン別の占有区間。先に固定(非対象)ノーツを全て予約する
  // (対象 LN の途中に入る将来の固定ノーツも避けるため、処理順に依らず先に積む)。
  const occ: Interval[][] = Array.from({ length: keyCount }, () => []);
  for (const n of notes) {
    if (!targets.has(n)) {
      occ[clampLane(n.lane, keyCount)].push({ start: n.time, end: noteEnd(n) });
    }
  }

  const newLane = new Map<Note, number>();
  const used = new Array<number>(keyCount).fill(0); // 均等化用の対象配置数
  let prevLanes: number[] = []; // 直前の(異なる)時刻に使われたレーン
  let curTime = Number.NaN;
  let curChord: number[] = []; // 現在処理中の同時刻ノーツのレーン

  // 対象ノーツを時間順に処理してレーンを割り当てる
  for (const n of notes) {
    if (!targets.has(n)) continue;
    const s = n.time;
    const e = noteEnd(n);

    if (s !== curTime) {
      if (curChord.length) prevLanes = curChord;
      curChord = [];
      curTime = s;
    }

    // s は単調増加。以後どのノーツとも被らない区間を刈って探索を軽く保つ
    for (let l = 0; l < keyCount; l++) {
      if (occ[l].length) occ[l] = occ[l].filter((iv) => iv.end >= s - guard);
    }

    // 重ならないレーンを集める
    const free: number[] = [];
    for (let l = 0; l < keyCount; l++) {
      const conflict = occ[l].some((iv) => iv.start <= e + guard && iv.end >= s - guard);
      if (!conflict) free.push(l);
    }

    let lane: number;
    if (free.length === 0) {
      lane = earliestLane(occ, keyCount); // 収まらない: 数は保持しつつ最小被りへ
    } else {
      lane = pickWeighted(free, used, prevLanes, curChord, bias, rng);
    }

    occ[lane].push({ start: s, end: e });
    used[lane]++;
    curChord.push(lane);
    newLane.set(n, lane);
  }

  return notes.map((n) => ({
    time: n.time,
    lane: newLane.has(n) ? (newLane.get(n) as number) : n.lane,
    type: n.type,
    dur: n.dur,
  }));
}

// 空きレーンからバイアスに従って1つ抽選する。中立なら一様。
function pickWeighted(
  free: number[],
  used: number[],
  prevLanes: number[],
  curChord: number[],
  bias: PatternBias,
  rng: () => number,
): number {
  let minUsed = Infinity;
  for (const l of free) if (used[l] < minUsed) minUsed = used[l];

  const weights: number[] = new Array(free.length);
  let total = 0;
  for (let i = 0; i < free.length; i++) {
    const l = free[i];
    let expo = 0;
    if (bias.jack && prevLanes.includes(l)) expo += C_JACK * bias.jack;
    if (bias.stream && prevLanes.some((p) => Math.abs(p - l) === 1)) expo += C_STREAM * bias.stream;
    if (bias.chordSpread && curChord.length) expo += C_CHORD * bias.chordSpread * minDist(l, curChord);
    if (bias.balance) expo -= C_BALANCE * bias.balance * (used[l] - minUsed);
    if (expo > EXP_CLAMP) expo = EXP_CLAMP;
    else if (expo < -EXP_CLAMP) expo = -EXP_CLAMP;
    const w = Math.exp(expo);
    weights[i] = w;
    total += w;
  }

  if (!(total > 0) || !Number.isFinite(total)) {
    return free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
  }
  let r = rng() * total;
  for (let i = 0; i < free.length; i++) {
    r -= weights[i];
    if (r < 0) return free[i];
  }
  return free[free.length - 1];
}
