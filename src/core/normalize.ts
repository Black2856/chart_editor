import type { Note } from './types';
import { compareNotes, isLong, noteEnd, sortNotes } from './types';

// AI生成譜面の「物理的に不可能な配置」を検出・正規化する純粋関数群。
//   ① ロングノーツの押下中・終端に重なる同レーンの別ノーツ tap/LN
//      (押しっぱなし中の打鍵、LN終点と次ノーツ始点の一致/接近なども含む=不可能)
//   ② ほぼ同じ開始タイミングで同レーンに複数ノーツ (同一キーの同時押し=不可能)
// 解決方法は問題種別ごとに move(別レーンへ退避)/delete(除去) を選べる。
// LN 同士の重なりは、開始がほぼ同時なら②、それ以外の重なり(終端接触を含む)なら①に分類される。

export type ResolveAction = 'move' | 'delete';

// ②「ほぼ同タイミング」の既定閾値(ms)。AI生成の微小ズレと物理的な同時押し限界を吸収。
// 大きすぎると正常な高速連打を誤検出する。較正用に調整可能。
export const DEFAULT_DUP_THRESHOLD_MS = 30;

export interface NormalizeOptions {
  lnOverlap: ResolveAction; // ① LN中の単ノーツの解決方法
  duplicate: ResolveAction; // ② 同レーンほぼ同時の解決方法
  keyCount: number;
  dupThresholdMs?: number; // 既定 DEFAULT_DUP_THRESHOLD_MS
}

export interface NormalizeReport {
  duplicates: number; // ② 検出した問題ノーツ数
  lnOverlaps: number; // ① 検出した問題ノーツ数
  moved: number; // 別レーンへ退避した数
  removed: number; // 削除した数 (移動先が無く削除した分も含む)
}

export interface NormalizeResult {
  notes: Note[];
  report: NormalizeReport;
}

type Reason = 'dup' | 'ln';

/** クラスタ内で残すノーツを選ぶ: LN優先 → 長い順 → 早い順。 */
function pickKeep(cluster: Note[]): Note {
  let best = cluster[0];
  for (let i = 1; i < cluster.length; i++) {
    const n = cluster[i];
    const nLong = isLong(n);
    const bLong = isLong(best);
    if (nLong !== bLong) {
      if (nLong) best = n; // LN優先
      continue;
    }
    if (n.dur !== best.dur) {
      if (n.dur > best.dur) best = n; // 長い方
      continue;
    }
    if (n.time < best.time) best = n; // 早い方
  }
  return best;
}

/**
 * 問題ノーツを分類する。返り値は「除去/移動の対象となるノーツ」→ 理由 の Map。
 * ② を先に確定し、② で残ったノーツのみ ① 判定の対象にする (二重計上を避ける)。
 */
function classifyProblems(notes: Note[], threshold: number): Map<Note, Reason> {
  const problems = new Map<Note, Reason>();
  const sorted = [...notes].sort(compareNotes);

  // レーンごとに time 昇順で集約
  const byLane = new Map<number, Note[]>();
  for (const n of sorted) {
    const arr = byLane.get(n.lane);
    if (arr) arr.push(n);
    else byLane.set(n.lane, [n]);
  }

  // ② 同レーン・ほぼ同時のクラスタを検出 (基準は各クラスタ先頭の time)
  for (const group of byLane.values()) {
    let i = 0;
    while (i < group.length) {
      const start = group[i];
      let j = i + 1;
      while (j < group.length && group[j].time - start.time < threshold) j++;
      if (j - i > 1) {
        const cluster = group.slice(i, j);
        const keep = pickKeep(cluster);
        for (const n of cluster) if (n !== keep) problems.set(n, 'dup');
      }
      i = j;
    }
  }

  // ① 残った LN の期間中・終端に重なる/接触する後続ノーツを検出 (開始近接は②で処理済み)。
  //    LN を離す瞬間に同キーを打つ「LN終点と次ノーツ始点の一致/接近」も collides で拾う。
  for (const group of byLane.values()) {
    for (const ln of group) {
      if (!isLong(ln) || problems.has(ln)) continue;
      for (const m of group) {
        if (m === ln || problems.has(m)) continue;
        if (m.time > ln.time && collides(m, ln, threshold)) problems.set(m, 'ln');
      }
    }
  }

  return problems;
}

/** a と b が時間的に衝突するか (tap は threshold 分の幅を持たせ「ほぼ同時」も衝突扱い)。 */
function collides(a: Note, b: Note, threshold: number): boolean {
  return a.time < noteEnd(b) + threshold && b.time < noteEnd(a) + threshold;
}

/** base 内で note と衝突しない、最も近いレーンを探す (近い順 ±1,±2…)。無ければ null。 */
function findFreeLane(
  note: Note,
  base: Note[],
  keyCount: number,
  threshold: number,
): number | null {
  const laneFree = (lane: number): boolean => {
    for (const b of base) {
      if (b.lane !== lane) continue;
      if (collides(note, b, threshold)) return false;
    }
    return true;
  };
  for (let d = 1; d < keyCount; d++) {
    const right = note.lane + d;
    if (right < keyCount && laneFree(right)) return right;
    const left = note.lane - d;
    if (left >= 0 && laneFree(left)) return left;
  }
  return null;
}

/**
 * 譜面を正規化する。notes は破壊せず、新しい配列を返す。
 * 問題種別ごとに move/delete を適用し、move で退避先が無い場合は削除する。
 */
export function normalizeChart(notes: Note[], options: NormalizeOptions): NormalizeResult {
  const threshold = options.dupThresholdMs ?? DEFAULT_DUP_THRESHOLD_MS;
  const problems = classifyProblems(notes, threshold);

  const report: NormalizeReport = { duplicates: 0, lnOverlaps: 0, moved: 0, removed: 0 };
  for (const reason of problems.values()) {
    if (reason === 'dup') report.duplicates++;
    else report.lnOverlaps++;
  }

  // 問題でないノーツを確定集合(base)に。move したノーツも追加し後続の衝突判定へ反映する。
  const base: Note[] = notes
    .filter((n) => !problems.has(n))
    .map((n) => ({ time: n.time, lane: n.lane, type: n.type, dur: n.dur }));

  // 問題ノーツを time 順に解決
  const probList = notes.filter((n) => problems.has(n)).sort(compareNotes);
  for (const p of probList) {
    const reason = problems.get(p)!;
    const action = reason === 'dup' ? options.duplicate : options.lnOverlap;
    const clone: Note = { time: p.time, lane: p.lane, type: p.type, dur: p.dur };
    if (action === 'move') {
      const lane = findFreeLane(clone, base, options.keyCount, threshold);
      if (lane !== null) {
        clone.lane = lane;
        base.push(clone);
        report.moved++;
        continue;
      }
    }
    report.removed++; // delete、または move 不能で削除
  }

  return { notes: sortNotes(base), report };
}

/** 件数のみ知りたい場合の検出 (UI のプレビュー用)。 */
export function detectIssues(
  notes: Note[],
  dupThresholdMs = DEFAULT_DUP_THRESHOLD_MS,
): { duplicates: number; lnOverlaps: number } {
  const problems = classifyProblems(notes, dupThresholdMs);
  let duplicates = 0;
  let lnOverlaps = 0;
  for (const reason of problems.values()) {
    if (reason === 'dup') duplicates++;
    else lnOverlaps++;
  }
  return { duplicates, lnOverlaps };
}
