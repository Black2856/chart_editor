<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Panel } from '../stores/charts';
import { useChartsStore } from '../stores/charts';
import type { Note } from '../core/types';
import { gridLinesInRange, snapTime } from '../core/snap';
import { applyEdgeMove, combineEdge, notesInRectWithEdges, type Edge } from '../core/selection';

const props = defineProps<{ panel: Panel }>();
const store = useChartsStore();

// ヘッダ D&D による並べ替え
const dragOver = ref(false);
function onHeadDragStart(e: DragEvent): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData('text/panel-id', props.panel.id);
  e.dataTransfer.effectAllowed = 'move';
}
function onPanelDragOver(e: DragEvent): void {
  // パネル並べ替えのドラッグのみ受け付ける (他の D&D は無視)
  if (!e.dataTransfer || !e.dataTransfer.types.includes('text/panel-id')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  dragOver.value = true;
}
function onPanelDragLeave(e: DragEvent): void {
  // 子要素間の移動では消さない (currentTarget の外に出た時のみ)
  const ct = e.currentTarget as HTMLElement;
  if (!ct.contains(e.relatedTarget as Node | null)) dragOver.value = false;
}
function onPanelDrop(e: DragEvent): void {
  dragOver.value = false;
  const fromId = e.dataTransfer?.getData('text/panel-id');
  if (!fromId) return;
  e.preventDefault();
  store.reorderPanel(fromId, props.panel.id);
}

const wrapRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let raf = 0;
let ro: ResizeObserver | null = null;

const LANE_W = 46;
const PAD = 3;
const NOTE_H = 11;
const JUDGE_FRAC = 0.84;

// パネル canvas 登録 (パネル間移動のヒットテスト用)
export interface CanvasReg {
  el: HTMLCanvasElement;
  panel: Panel;
}
const registry = (window as any).__panelCanvasRegistry__ ?? new Map<string, CanvasReg>();
(window as any).__panelCanvasRegistry__ = registry;

// --- 座標変換 ---
function judgeY(h: number): number {
  return h * JUDGE_FRAC;
}
function timeToY(t: number, h: number): number {
  return judgeY(h) - (t - store.currentTime) * store.pxPerMs;
}
function yToTime(y: number, h: number): number {
  return store.currentTime + (judgeY(h) - y) / store.pxPerMs;
}
function laneToX(lane: number): number {
  return lane * LANE_W;
}
function xToLane(x: number): number {
  return Math.floor(x / LANE_W);
}

function visibleNotesSlice(tMin: number, tMax: number): Note[] {
  const notes = props.panel.notes;
  // long 対応で margin を取って線形に絞る (notes は time 昇順)
  const lo = lowerBound(notes, tMin - 3000);
  const out: Note[] = [];
  for (let i = lo; i < notes.length; i++) {
    if (notes[i].time > tMax) break;
    out.push(notes[i]);
  }
  return out;
}

function lowerBound(notes: Note[], time: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function snapForPanel(time: number, near?: Note[]): number {
  return snapTime(time, props.panel.timing, store.snapStepBeats, store.noteSnap ? near : undefined, 30);
}

// --- 描画 ---
function resize(): void {
  const wrap = wrapRef.value;
  const canvas = canvasRef.value;
  if (!wrap || !canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = props.panel.keyCount * LANE_W;
  const h = wrap.clientHeight;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw(): void {
  const canvas = canvasRef.value;
  if (!canvas || !ctx) return;
  const w = props.panel.keyCount * LANE_W;
  const h = canvas.height / (window.devicePixelRatio || 1);
  const c = ctx;
  c.clearRect(0, 0, w, h);

  // 背景
  c.fillStyle = props.panel.id === store.activePanelId ? '#15171c' : '#101216';
  c.fillRect(0, 0, w, h);

  const tBottom = yToTime(h, h);
  const tTop = yToTime(0, h);
  const tMin = Math.min(tBottom, tTop);
  const tMax = Math.max(tBottom, tTop);

  // グリッド
  const lines = gridLinesInRange(props.panel.timing, store.snapStepBeats, tMin, tMax);
  for (const ln of lines) {
    const y = timeToY(ln.time, h);
    if (ln.kind === 'measure') {
      c.strokeStyle = '#8093ab';
      c.lineWidth = 2.2;
    } else if (ln.kind === 'beat') {
      c.strokeStyle = '#525d6e';
      c.lineWidth = 1.4;
    } else {
      c.strokeStyle = '#363d49';
      c.lineWidth = 1;
    }
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }

  // レーン区切り
  c.strokeStyle = '#23272e';
  c.lineWidth = 1;
  for (let i = 0; i <= props.panel.keyCount; i++) {
    const x = laneToX(i);
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h);
    c.stroke();
  }

  // ノーツ
  const laneColors = ['#4cc4ff', '#ffe14c', '#ff7ab3', '#7affa0', '#c08bff', '#ff9a4c', '#5ad6d6'];
  const vis = visibleNotesSlice(tMin, tMax);
  const sel = props.panel.selection;
  const edges = props.panel.edges;
  const preview = dragMove.value;
  for (const n of vis) {
    const selected = sel.has(n);
    const edge: Edge = n.type === 1 ? edges.get(n) ?? 'both' : 'both';
    // プレビューは確定移動と同じ applyEdgeMove で算出 (端リサイズも一致)
    const pn =
      preview && selected
        ? applyEdgeMove(n, edge, preview.dt, preview.dl, props.panel.keyCount)
        : n;
    const lane = pn.lane;
    const x = laneToX(lane) + PAD;
    const bw = LANE_W - PAD * 2;
    const color = laneColors[lane % laneColors.length];
    if (n.type === 1) {
      const yStart = timeToY(pn.time, h);
      const yEnd = timeToY(pn.time + pn.dur, h);
      c.fillStyle = color + '55';
      c.fillRect(x, yEnd, bw, yStart - yEnd);
      c.fillStyle = color;
      c.fillRect(x, yStart - NOTE_H / 2, bw, NOTE_H);
      c.fillRect(x, yEnd - NOTE_H / 2, bw, NOTE_H);
    } else {
      const y = timeToY(pn.time, h);
      c.fillStyle = color;
      c.fillRect(x, y - NOTE_H / 2, bw, NOTE_H);
    }
    if (selected) {
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.6;
      if (n.type === 1 && edge === 'head') {
        c.strokeRect(x - 1, timeToY(pn.time, h) - NOTE_H / 2, bw + 2, NOTE_H);
      } else if (n.type === 1 && edge === 'tail') {
        c.strokeRect(x - 1, timeToY(pn.time + pn.dur, h) - NOTE_H / 2, bw + 2, NOTE_H);
      } else if (n.type === 1) {
        const yTop = timeToY(pn.time + pn.dur, h) - NOTE_H / 2;
        c.strokeRect(x - 1, yTop, bw + 2, pn.dur * store.pxPerMs + NOTE_H);
      } else {
        c.strokeRect(x - 1, timeToY(pn.time, h) - NOTE_H / 2, bw + 2, NOTE_H);
      }
    }
  }

  // long ドラッグ中のプレビュー
  if (longDraft.value) {
    const d = longDraft.value;
    const x = laneToX(d.lane) + PAD;
    const bw = LANE_W - PAD * 2;
    const y1 = timeToY(Math.min(d.start, d.end), h);
    const y2 = timeToY(Math.max(d.start, d.end), h);
    c.fillStyle = '#ffffff44';
    c.fillRect(x, y2, bw, y1 - y2);
  }

  // 矩形選択 (始点 y0 は t0 から毎フレーム算出 → スクロールしても始点の時刻が固定)
  if (rubber.value) {
    const r = rubber.value;
    const y0 = timeToY(r.t0, h);
    c.strokeStyle = '#7fd4ff';
    c.lineWidth = 1;
    c.setLineDash([4, 3]);
    c.strokeRect(
      Math.min(r.x0, r.x1),
      Math.min(y0, r.y1),
      Math.abs(r.x1 - r.x0),
      Math.abs(r.y1 - y0),
    );
    c.setLineDash([]);
  }

  // マーカー (曲位置・全パネル共有)
  for (const mt of store.markers) {
    if (mt < tMin || mt > tMax) continue;
    const y = timeToY(mt, h);
    c.strokeStyle = '#ffb03a';
    c.lineWidth = 1.6;
    c.setLineDash([6, 4]);
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#ffb03a';
    c.fillRect(0, y - 2, 7, 4);
    c.fillRect(w - 7, y - 2, 7, 4);
  }

  // 判定線 (再生ヘッド)
  const jy = judgeY(h);
  c.strokeStyle = '#ff5d6c';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, jy);
  c.lineTo(w, jy);
  c.stroke();
}

function loop(): void {
  draw();
  raf = requestAnimationFrame(loop);
}

// --- 操作 ---
interface DragMove {
  dt: number;
  dl: number;
}
const dragMove = ref<DragMove | null>(null);
const longDraft = ref<{ lane: number; start: number; end: number } | null>(null);
// 矩形選択: 始点は time(t0) で保持しスクロールに追従させる (始点が時間的にズレない)
const rubber = ref<{ x0: number; t0: number; x1: number; y1: number } | null>(null);

type Mode = 'none' | 'move' | 'rubber' | 'long';
let mode: Mode = 'none';
let downTime = 0;
let downLane = 0;
let downNote: Note | null = null; // 移動の基準ノーツ (グリッド吸着のアンカー)
let downEdge: Edge = 'both'; // 'head'/'tail' なら端リサイズ

function localPos(e: PointerEvent): { x: number; y: number; h: number } {
  const canvas = canvasRef.value!;
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top, h: rect.height };
}

function hitTest(time: number, lane: number, h: number): Note | null {
  const tol = NOTE_H / store.pxPerMs; // px -> ms
  let best: Note | null = null;
  let bestDist = Infinity;
  for (const n of props.panel.notes) {
    if (n.lane !== lane) continue;
    if (n.type === 1) {
      if (time >= n.time - tol && time <= n.time + n.dur + tol) return n;
    } else {
      const d = Math.abs(n.time - time);
      if (d <= tol && d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
  }
  void h;
  return best;
}

/** LN のどの部分をつかんだか判定 (始点付近=head / 終点付近=tail / それ以外=both)。 */
function edgeAt(time: number, n: Note): Edge {
  if (n.type !== 1 || n.dur <= 0) return 'both';
  const tol = NOTE_H / store.pxPerMs; // px -> ms
  const headD = Math.abs(time - n.time);
  const tailD = Math.abs(time - (n.time + n.dur));
  if (headD <= tol && headD <= tailD) return 'head';
  if (tailD <= tol) return 'tail';
  return 'both';
}

function onPointerDown(e: PointerEvent): void {
  const canvas = canvasRef.value!;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* 合成イベント等でアクティブポインタが無い場合は無視 */
  }
  store.activePanelId = props.panel.id;
  const { x, y, h } = localPos(e);
  const rawTime = yToTime(y, h);
  const lane = Math.max(0, Math.min(props.panel.keyCount - 1, xToLane(x)));
  downLane = lane;

  if (e.button === 2) {
    // 右クリック: 常に削除
    const hit = hitTest(rawTime, lane, h);
    if (hit) store.deleteNotes(props.panel, [hit]);
    return;
  }

  const tool = store.tool;
  if (tool === 'tap') {
    const t = snapForPanel(rawTime, visibleNotesSlice(rawTime - 1000, rawTime + 1000));
    store.addNote(props.panel, { time: Math.max(0, Math.round(t)), lane, type: 0, dur: 0 });
    return;
  }
  if (tool === 'delete') {
    const hit = hitTest(rawTime, lane, h);
    if (hit) store.deleteNotes(props.panel, [hit]);
    return;
  }
  if (tool === 'long') {
    const t = snapForPanel(rawTime, visibleNotesSlice(rawTime - 1000, rawTime + 1000));
    mode = 'long';
    downTime = Math.max(0, Math.round(t));
    longDraft.value = { lane, start: downTime, end: downTime };
    return;
  }
  // select
  const hit = hitTest(rawTime, lane, h);
  if (hit) {
    const edge = edgeAt(rawTime, hit);
    if (edge !== 'both') {
      // LN の端をつかんでリサイズ: その端だけを選択
      store.setSelection(props.panel, [hit], new Map([[hit, edge]]));
    } else if (!props.panel.selection.has(hit)) {
      store.setSelection(props.panel, [hit]);
    }
    mode = 'move';
    downTime = rawTime;
    downNote = hit;
    downEdge = edge;
    dragMove.value = { dt: 0, dl: 0 };
  } else {
    if (!e.shiftKey) store.clearSelection(props.panel);
    mode = 'rubber';
    rubber.value = { x0: x, t0: rawTime, x1: x, y1: y };
  }
}

function onPointerMove(e: PointerEvent): void {
  if (mode === 'none') return;
  const { x, y, h } = localPos(e);
  const rawTime = yToTime(y, h);
  const lane = Math.max(0, Math.min(props.panel.keyCount - 1, xToLane(x)));

  if (mode === 'long' && longDraft.value) {
    const t = snapForPanel(rawTime, visibleNotesSlice(rawTime - 1000, rawTime + 1000));
    longDraft.value = { ...longDraft.value, end: Math.max(0, Math.round(t)) };
  } else if (mode === 'move' && downNote) {
    // 基準ノーツ(端)自身がグリッドに乗るよう dt を算出 → グリッド外ノーツも整列する
    const sel = props.panel.selection;
    const near = visibleNotesSlice(rawTime - 1000, rawTime + 1000).filter((n) => !sel.has(n));
    const anchorTime = downEdge === 'tail' ? downNote.time + downNote.dur : downNote.time;
    const target = snapForPanel(anchorTime + (rawTime - downTime), near);
    const dt = Math.round(target - anchorTime);
    const dl = downEdge === 'both' ? lane - downLane : 0; // 端リサイズはレーン不変
    dragMove.value = { dt, dl };
  } else if (mode === 'rubber' && rubber.value) {
    rubber.value = { ...rubber.value, x1: x, y1: y };
  }
}

function findDropPanel(clientX: number, clientY: number): Panel | null {
  for (const reg of registry.values() as IterableIterator<CanvasReg>) {
    const r = reg.el.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      return reg.panel;
    }
  }
  return null;
}

function onPointerUp(e: PointerEvent): void {
  const canvas = canvasRef.value!;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  const { x, y, h } = localPos(e);

  if (mode === 'long' && longDraft.value) {
    const d = longDraft.value;
    const start = Math.min(d.start, d.end);
    const end = Math.max(d.start, d.end);
    const dur = end - start;
    if (dur <= 0) {
      store.addNote(props.panel, { time: start, lane: d.lane, type: 0, dur: 0 });
    } else {
      store.addNote(props.panel, { time: start, lane: d.lane, type: 1, dur });
    }
    longDraft.value = null;
  } else if (mode === 'move' && dragMove.value) {
    const target = findDropPanel(e.clientX, e.clientY);
    const dm = dragMove.value;
    if (target && target.id !== props.panel.id) {
      const tRect = (registry.get(target.id) as CanvasReg).el.getBoundingClientRect();
      const targetLane = Math.max(
        0,
        Math.min(target.keyCount - 1, Math.floor((e.clientX - tRect.left) / LANE_W)),
      );
      store.moveNotesToPanel(props.panel, target, [...props.panel.selection], dm.dt, targetLane);
    } else if (dm.dt !== 0 || dm.dl !== 0) {
      store.moveSelection(props.panel, dm.dt, dm.dl);
    }
    dragMove.value = null;
    downNote = null;
    downEdge = 'both';
  } else if (mode === 'rubber' && rubber.value) {
    const r = rubber.value;
    const t0 = r.t0; // 始点は時刻で保持済み
    const t1 = yToTime(r.y1, h);
    const l0 = xToLane(Math.min(r.x0, r.x1));
    const l1 = xToLane(Math.max(r.x0, r.x1));
    const { notes: found, edges } = notesInRectWithEdges(
      props.panel.notes,
      { start: t0, end: t1 },
      l0,
      l1,
    );
    if (e.shiftKey) {
      const mergedEdges = new Map(props.panel.edges);
      for (const [n, ed] of edges) {
        const prev = props.panel.edges.get(n) ?? (props.panel.selection.has(n) ? 'both' : undefined);
        const combined = prev ? combineEdge(prev, ed) : ed;
        if (combined === 'both') mergedEdges.delete(n);
        else mergedEdges.set(n, combined);
      }
      store.setSelection(props.panel, [...props.panel.selection, ...found], mergedEdges);
    } else {
      store.setSelection(props.panel, found, edges);
    }
    rubber.value = null;
  }
  void x;
  void y;
  mode = 'none';
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  if (e.ctrlKey) {
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    store.pxPerMs = Math.max(0.05, Math.min(3, store.pxPerMs * factor));
    return;
  }
  const deltaMs = (e.deltaY / store.pxPerMs) * 0.6;
  store.seek(store.currentTime - deltaMs);
}

onMounted(() => {
  const canvas = canvasRef.value!;
  ctx = canvas.getContext('2d');
  registry.set(props.panel.id, { el: canvas, panel: props.panel });
  resize();
  ro = new ResizeObserver(() => resize());
  if (wrapRef.value) ro.observe(wrapRef.value);
  loop();
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
  registry.delete(props.panel.id);
});

watch(
  () => props.panel.keyCount,
  () => resize(),
);
</script>

<template>
  <div
    class="panel"
    :class="{ active: panel.id === store.activePanelId, dragover: dragOver }"
    @dragover="onPanelDragOver"
    @dragleave="onPanelDragLeave"
    @drop="onPanelDrop"
  >
    <div
      class="panel-head"
      :draggable="store.panels.length > 1"
      title="ドラッグで並べ替え"
      @dragstart="onHeadDragStart"
      @dragend="dragOver = false"
    >
      <span class="pname" :title="panel.name">{{ panel.name }}</span>
      <span class="ptag">{{ panel.format }} · {{ panel.keyCount }}K</span>
      <span class="pstar">★{{ panel.difficulty.star.toFixed(1) }}</span>
      <button
        class="mini"
        :class="{ on: store.playbackPanelId === panel.id }"
        title="この譜面を再生対象に"
        @click="store.playbackPanelId = panel.id"
      >
        ♪
      </button>
      <button class="mini" title="閉じる" @click="store.removePanel(panel.id)">✕</button>
    </div>
    <div ref="wrapRef" class="canvas-wrap">
      <canvas
        ref="canvasRef"
        :data-panel-id="panel.id"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @wheel="onWheel"
        @contextmenu.prevent
      ></canvas>
    </div>
    <div class="panel-foot">
      {{ panel.notes.length }} notes · sel {{ panel.selection.size }} ·
      {{ (store.currentTime / 1000).toFixed(2) }}s
    </div>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  border: 1px solid #2a2f37;
  border-radius: 6px;
  overflow: hidden;
  background: #0d0f13;
  height: 100%;
}
.panel.active {
  border-color: #4cc4ff;
}
.panel.dragover {
  border-color: #ffb03a;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: #161a20;
  font-size: 12px;
}
.panel-head[draggable='true'] {
  cursor: grab;
}
.panel-head[draggable='true']:active {
  cursor: grabbing;
}
.pname {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ptag {
  color: #8a93a0;
}
.pstar {
  color: #ffd24c;
  margin-left: auto;
}
.mini {
  background: #232a33;
  border: 1px solid #333b45;
  color: #cdd3da;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 2px 5px;
}
.mini.on {
  background: #1d5a7a;
  border-color: #4cc4ff;
  color: #fff;
}
.canvas-wrap {
  flex: 1;
  overflow: hidden;
  position: relative;
}
canvas {
  display: block;
  cursor: crosshair;
}
.panel-foot {
  padding: 3px 6px;
  font-size: 11px;
  color: #8a93a0;
  background: #131519;
  border-top: 1px solid #21262d;
}
</style>
