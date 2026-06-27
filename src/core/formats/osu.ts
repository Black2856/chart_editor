import type { Chart, ChartMeta, Note, TimingInfo } from '../types';
import { inferKeyCount, sortNotes } from '../types';
import { chartId } from '../hash';

// osu! mania (Mode 3) の parse / serialize。
// レーン <-> x 変換: lane = floor(x * keyCount / 512), x = floor((lane + 0.5) * 512 / keyCount)
// HitObject: x,y,time,type,hitSound,objParams,hitSample
//   type bit0(1)=通常ノーツ -> tap, bit7(128)=ホールド -> long (objParams 先頭=endTime)
// ソフラン/ノーツサウンドは I/O 非対応。基本BPMのみ TimingPoints から採用。

interface OsuSection {
  [key: string]: string;
}

function laneFromX(x: number, keyCount: number): number {
  const lane = Math.floor((x * keyCount) / 512);
  return Math.max(0, Math.min(keyCount - 1, lane));
}

function xFromLane(lane: number, keyCount: number): number {
  return Math.floor(((lane + 0.5) * 512) / keyCount);
}

function parseKeyValueSection(lines: string[]): OsuSection {
  const out: OsuSection = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

interface ParsedSections {
  [name: string]: string[];
}

function splitSections(text: string): ParsedSections {
  const sections: ParsedSections = {};
  let current = '__header__';
  sections[current] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const m = /^\[(.+)\]$/.exec(line.trim());
    if (m) {
      current = m[1];
      sections[current] = [];
      continue;
    }
    if (line.trim() === '' || line.trim().startsWith('//')) continue;
    (sections[current] ||= []).push(line);
  }
  return sections;
}

export interface OsuParseResult {
  notes: Note[];
  keyCount: number;
  timing: TimingInfo;
  meta: ChartMeta;
  audioFilename?: string;
}

export function parseOsu(text: string): OsuParseResult {
  const sections = splitSections(text);

  const general = parseKeyValueSection(sections['General'] ?? []);
  const metadata = parseKeyValueSection(sections['Metadata'] ?? []);
  const difficulty = parseKeyValueSection(sections['Difficulty'] ?? []);

  const keyCount = Math.max(1, Math.round(Number(difficulty['CircleSize'] ?? '4')) || 4);

  // TimingPoints: 最初の非継承(正の beatLength)から bpm/offset。
  let timing: TimingInfo = { offsetMs: 0, bpm: 120 };
  for (const line of sections['TimingPoints'] ?? []) {
    const parts = line.split(',');
    const time = Number(parts[0]);
    const beatLength = Number(parts[1]);
    if (Number.isFinite(beatLength) && beatLength > 0) {
      timing = { offsetMs: Number.isFinite(time) ? time : 0, bpm: 60000 / beatLength };
      break;
    }
  }

  const notes: Note[] = [];
  for (const line of sections['HitObjects'] ?? []) {
    const parts = line.split(',');
    if (parts.length < 4) continue;
    const x = Number(parts[0]);
    const time = Number(parts[2]);
    const type = Number(parts[3]);
    if (!Number.isFinite(x) || !Number.isFinite(time) || !Number.isFinite(type)) continue;
    const lane = laneFromX(x, keyCount);

    if (type & 128) {
      // ホールド: parts[5] = endTime:hitSample
      const param = parts[5] ?? '';
      const endTime = Number(param.split(':')[0]);
      const dur = Number.isFinite(endTime) ? Math.max(0, endTime - time) : 0;
      notes.push({ time, lane, type: 1, dur });
    } else {
      notes.push({ time, lane, type: 0, dur: 0 });
    }
  }
  sortNotes(notes);

  const meta: ChartMeta = {
    title: metadata['Title'] || metadata['TitleUnicode'],
    artist: metadata['Artist'] || metadata['ArtistUnicode'],
    creator: metadata['Creator'],
    version: metadata['Version'],
  };

  return {
    notes,
    keyCount: inferKeyCount(notes, keyCount),
    timing,
    meta,
    audioFilename: general['AudioFilename'],
  };
}

export function osuToChart(text: string, name: string): Chart {
  const r = parseOsu(text);
  return {
    id: chartId(r.notes),
    name,
    format: 'osu',
    keyCount: r.keyCount,
    notes: r.notes,
    timing: r.timing,
    meta: r.meta,
    audioFilename: r.audioFilename,
  };
}

export function serializeOsu(chart: Chart): string {
  const m = chart.meta ?? {};
  const beatLength = 60000 / (chart.timing.bpm || 120);
  const lines: string[] = [];
  lines.push('osu file format v14');
  lines.push('');
  lines.push('[General]');
  lines.push(`AudioFilename: ${chart.audioFilename ?? ''}`);
  lines.push('AudioLeadIn: 0');
  lines.push('PreviewTime: -1');
  lines.push('Countdown: 0');
  lines.push('SampleSet: Soft');
  lines.push('StackLeniency: 0.7');
  lines.push('Mode: 3');
  lines.push('LetterboxInBreaks: 0');
  lines.push('SpecialStyle: 0');
  lines.push('WidescreenStoryboard: 0');
  lines.push('');
  lines.push('[Editor]');
  lines.push('DistanceSpacing: 1.0');
  lines.push('BeatDivisor: 4');
  lines.push('GridSize: 8');
  lines.push('TimelineZoom: 1.0');
  lines.push('');
  lines.push('[Metadata]');
  lines.push(`Title:${m.title ?? ''}`);
  lines.push(`TitleUnicode:${m.title ?? ''}`);
  lines.push(`Artist:${m.artist ?? ''}`);
  lines.push(`ArtistUnicode:${m.artist ?? ''}`);
  lines.push(`Creator:${m.creator ?? ''}`);
  lines.push(`Version:${m.version ?? '1'}`);
  lines.push('Source:');
  lines.push('Tags:');
  lines.push('');
  lines.push('[Difficulty]');
  lines.push('HPDrainRate:5.0');
  lines.push(`CircleSize:${chart.keyCount}`);
  lines.push('OverallDifficulty:8.0');
  lines.push('ApproachRate:5.0');
  lines.push('SliderMultiplier:1.4');
  lines.push('SliderTickRate:1.0');
  lines.push('');
  lines.push('[Events]');
  lines.push('');
  lines.push('[TimingPoints]');
  lines.push(`${chart.timing.offsetMs},${beatLength},4,2,0,100,1,0`);
  lines.push('');
  lines.push('[HitObjects]');
  for (const n of chart.notes) {
    const x = xFromLane(n.lane, chart.keyCount);
    if (n.type === 1) {
      const endTime = n.time + n.dur;
      lines.push(`${x},192,${n.time},128,0,${endTime}:0:0:0:0:`);
    } else {
      lines.push(`${x},192,${n.time},1,0,0:0:0:0:`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
