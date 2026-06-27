import type { Chart, Note } from '../types';
import { inferKeyCount, sortNotes } from '../types';
import { chartId } from '../hash';
import { analyzeChart } from '../difficulty/analyze';

// txt 形式:
//   <id16>,<overall>:<note>/<note>/...
//   ヘッダ = 譜面id(16桁hex),難易度指数(overall) を ',' 区切り、':' で終端。
//   ノーツ = time,lane,type[,dur] を '/' 区切り。3値=tap / 4値=long。すべて ms。
// keyCount は txt に明示が無いため max(lane)+1 で自動判定。

export interface TxtParseResult {
  notes: Note[];
  keyCount: number;
  id?: string;
  difficulty?: number;
}

export function parseTxt(text: string): TxtParseResult {
  const trimmed = text.trim();

  let header = '';
  let body = trimmed;
  const colon = trimmed.indexOf(':');
  if (colon >= 0) {
    header = trimmed.slice(0, colon).trim();
    body = trimmed.slice(colon + 1).trim();
  }

  let id: string | undefined;
  let difficulty: number | undefined;
  if (header) {
    const h = header.split(',');
    id = h[0]?.trim() || undefined;
    const d = Number(h[1]);
    if (Number.isFinite(d)) difficulty = d;
  }

  const notes: Note[] = [];
  for (const token of body.split('/')) {
    const t = token.trim();
    if (!t) continue;
    const f = t.split(',').map((v) => Number(v.trim()));
    if (f.length < 3) continue;
    const [time, lane, type] = f;
    if (!Number.isFinite(time) || !Number.isFinite(lane) || !Number.isFinite(type)) continue;
    if (type === 1) {
      const dur = Number.isFinite(f[3]) ? Math.max(0, f[3]) : 0;
      notes.push({ time, lane, type: 1, dur });
    } else {
      notes.push({ time, lane, type: 0, dur: 0 });
    }
  }
  sortNotes(notes);

  return { notes, keyCount: inferKeyCount(notes), id, difficulty };
}

export function txtToChart(text: string, name: string): Chart {
  const r = parseTxt(text);
  return {
    id: chartId(r.notes),
    name,
    format: 'txt',
    keyCount: r.keyCount,
    notes: r.notes,
    timing: { offsetMs: 0, bpm: 120 },
  };
}

/** 難易度指数 (star = overall/3, 小数第1位) を埋め込んだ txt 文字列を生成。 */
export function serializeTxt(chart: Chart): string {
  const id = chartId(chart.notes);
  const star = chart.difficulty?.star ?? analyzeChart(chart.notes).star;
  const body = chart.notes
    .map((n) => (n.type === 1 ? `${n.time},${n.lane},1,${n.dur}` : `${n.time},${n.lane},0`))
    .join('/');
  return `${id},${star.toFixed(1)}:${body}`;
}
