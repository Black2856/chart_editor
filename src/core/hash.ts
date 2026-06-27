import type { Note } from './types';
import { compareNotes } from './types';

// 譜面id: ノーツ内容のみから生成 (難易度・尺は混ぜない)。
// FNV-1a 64bit を BigInt で計算し、16桁(hex)へ。

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i) & 0xff);
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash;
}

/** ノーツ列の正規化文字列 (id 計算の入力)。 */
export function canonicalNoteString(notes: Note[]): string {
  const sorted = [...notes].sort(compareNotes);
  return sorted.map((n) => `${n.time},${n.lane},${n.type},${n.dur}`).join('/');
}

/** ノーツ内容ハッシュの先頭16桁(hex)。 */
export function chartId(notes: Note[]): string {
  const h = fnv1a64(canonicalNoteString(notes));
  return h.toString(16).padStart(16, '0').slice(0, 16);
}
