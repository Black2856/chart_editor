import { defineStore } from 'pinia';
import { markRaw, reactive, ref } from 'vue';
import type { Chart, ChartMeta, Note, TimingInfo, DifficultyResult } from '../core/types';
import { sortNotes } from '../core/types';
import { analyzeChart, emptyResult } from '../core/difficulty/analyze';
import { osuToChart } from '../core/formats/osu';
import { txtToChart } from '../core/formats/txt';
import { serializeOsu } from '../core/formats/osu';
import { serializeTxt } from '../core/formats/txt';
import { chartId } from '../core/hash';
import { SNAP_DIVISIONS } from '../core/snap';
import {
  type Clipboard,
  type Edge,
  copyNotes,
  pasteNotes,
  translateNotesWithEdges,
} from '../core/selection';
import {
  normalizeChart,
  type NormalizeReport,
  type ResolveAction,
} from '../core/normalize';
import { audioEngine } from '../audio/engine';

export type Tool = 'select' | 'tap' | 'long' | 'delete';

export interface Panel {
  id: string;
  name: string;
  format: 'osu' | 'txt';
  keyCount: number;
  notes: Note[]; // markRaw: canvas が直接読む
  timing: TimingInfo;
  audioFilename?: string;
  meta?: ChartMeta;
  difficulty: DifficultyResult;
  selection: Set<Note>; // markRaw
  edges: Map<Note, Edge>; // markRaw: LN 端単位の選択 ('both' は省略)
  selectionVersion: number; // 選択変化の通知
  rev: number; // ノーツ変化の通知 (canvas 再描画)
  undoStack: Note[][];
  redoStack: Note[][];
}

let panelCounter = 0;
const UNDO_LIMIT = 60;

function cloneNotes(notes: Note[]): Note[] {
  return notes.map((n) => ({ time: n.time, lane: n.lane, type: n.type, dur: n.dur }));
}

function makePanel(chart: Chart): Panel {
  const notes = markRaw(chart.notes);
  return reactive({
    id: `panel-${++panelCounter}`,
    name: chart.name,
    format: chart.format,
    keyCount: chart.keyCount,
    notes,
    timing: { ...chart.timing },
    audioFilename: chart.audioFilename,
    meta: chart.meta,
    difficulty: chart.difficulty ?? analyzeChart(notes),
    selection: markRaw(new Set<Note>()),
    edges: markRaw(new Map<Note, Edge>()),
    selectionVersion: 0,
    rev: 0,
    undoStack: markRaw([] as Note[][]),
    redoStack: markRaw([] as Note[][]),
  }) as Panel;
}

export const useChartsStore = defineStore('charts', () => {
  const panels = ref<Panel[]>([]);
  const activePanelId = ref<string | null>(null);

  // ビュー状態 (全パネル共有)
  const currentTime = ref(0); // ms 再生ヘッド / スクロール位置
  const pxPerMs = ref(0.35); // ズーム (px/ms)
  const syncScroll = ref(true);
  const tool = ref<Tool>('tap');
  const snapIndex = ref(3); // 既定 4分 (0=フリー,1=全,2=2分,3=4分)
  const noteSnap = ref(true);
  const chartAlign = ref<'left' | 'center' | 'right'>('center'); // チャート全体の表示位置

  // 再生
  const isPlaying = ref(false);
  const playbackPanelId = ref<string | null>(null);
  const seEnabled = ref(true);
  const musicVolume = ref(0.8);
  const seVolume = ref(0.7);
  const hasMusic = ref(false);
  const returnOnStop = ref(false); // 停止時に再生開始地点へ戻る

  // マーカー (曲位置・全パネル共有)
  const markers = ref<number[]>([]);

  const clipboard = ref<Clipboard | null>(null);

  // 正規化の直近結果 (UI 表示用)
  const lastNormalize = ref<NormalizeReport | null>(null);

  let rafId = 0;
  let playStartTime = 0;

  function getPanel(id: string | null): Panel | undefined {
    if (!id) return undefined;
    return panels.value.find((p) => p.id === id);
  }

  function activePanel(): Panel | undefined {
    return getPanel(activePanelId.value);
  }

  function playbackPanel(): Panel | undefined {
    return getPanel(playbackPanelId.value) ?? panels.value[0];
  }

  // ---- パネル追加・削除 ----
  function addChart(chart: Chart): Panel {
    const panel = makePanel(chart);
    panels.value.push(panel);
    if (!activePanelId.value) activePanelId.value = panel.id;
    if (!playbackPanelId.value) playbackPanelId.value = panel.id;
    return panel;
  }

  function loadOsuText(text: string, name: string): Panel {
    return addChart(osuToChart(text, name));
  }

  function loadTxtText(text: string, name: string): Panel {
    return addChart(txtToChart(text, name));
  }

  function isAudioFile(file: File): boolean {
    if (file.type.startsWith('audio/')) return true;
    return /\.(mp3|ogg|wav|m4a|flac|aac)$/i.test(file.name);
  }

  /** 種類混在のファイル群を拡張子/MIME で振り分けて読み込む (input・D&D 共用)。 */
  async function loadFiles(files: File[]): Promise<void> {
    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.osu')) {
        loadOsuText(await file.text(), file.name);
      } else if (lower.endsWith('.txt')) {
        loadTxtText(await file.text(), file.name);
      } else if (isAudioFile(file)) {
        await loadAudioFile(file);
      }
      // 未知の種類は無視
    }
  }

  function removePanel(id: string): void {
    const idx = panels.value.findIndex((p) => p.id === id);
    if (idx < 0) return;
    panels.value.splice(idx, 1);
    if (activePanelId.value === id) activePanelId.value = panels.value[0]?.id ?? null;
    if (playbackPanelId.value === id) playbackPanelId.value = panels.value[0]?.id ?? null;
  }

  function newEmptyChart(keyCount = 4): Panel {
    const notes: Note[] = [];
    const chart: Chart = {
      id: chartId(notes),
      name: `新規 ${keyCount}K`,
      format: 'txt',
      keyCount,
      notes,
      timing: { offsetMs: 0, bpm: 180 },
      difficulty: emptyResult(),
    };
    return addChart(chart);
  }

  // ---- 編集コア ----
  function recompute(panel: Panel): void {
    panel.difficulty = analyzeChart(panel.notes);
  }

  function bump(panel: Panel): void {
    panel.rev++;
  }

  function pushUndo(panel: Panel): void {
    panel.undoStack.push(cloneNotes(panel.notes));
    if (panel.undoStack.length > UNDO_LIMIT) panel.undoStack.shift();
    panel.redoStack.length = 0;
  }

  function setNotes(
    panel: Panel,
    notes: Note[],
    newSelection?: Note[],
    newEdges?: Map<Note, Edge>,
  ): void {
    sortNotes(notes);
    panel.notes = markRaw(notes);
    panel.selection = markRaw(new Set(newSelection ?? []));
    panel.edges = markRaw(newEdges ?? new Map<Note, Edge>());
    panel.selectionVersion++;
    recompute(panel);
    bump(panel);
  }

  function addNote(panel: Panel, note: Note): void {
    pushUndo(panel);
    const notes = cloneNotes(panel.notes);
    notes.push({ ...note });
    sortNotes(notes);
    // 追加したノーツを選択 (参照一致のため新配列から探す)
    const added = notes.find(
      (n) => n.time === note.time && n.lane === note.lane && n.type === note.type,
    );
    setNotes(panel, notes, added ? [added] : []);
  }

  function deleteNotes(panel: Panel, targets: Note[]): void {
    if (targets.length === 0) return;
    pushUndo(panel);
    const del = new Set(targets);
    const notes = panel.notes.filter((n) => !del.has(n)).map((n) => ({ ...n }));
    setNotes(panel, notes, []);
  }

  function deleteSelection(panel: Panel): void {
    deleteNotes(panel, [...panel.selection]);
  }

  function moveSelection(panel: Panel, dt: number, dl: number): void {
    if (panel.selection.size === 0) return;
    pushUndo(panel);
    const sel = panel.selection;
    const selNotes = [...sel];
    const moved = translateNotesWithEdges(selNotes, panel.edges, dt, dl, panel.keyCount);
    // 端選択 (head/tail) を移動後の新ノーツへ引き継ぐ → 連続編集が可能
    const newEdges = new Map<Note, Edge>();
    selNotes.forEach((orig, i) => {
      const e = panel.edges.get(orig);
      if (e && e !== 'both') newEdges.set(moved[i], e);
    });
    const kept = panel.notes.filter((n) => !sel.has(n)).map((n) => ({ ...n }));
    setNotes(panel, [...kept, ...moved], moved, newEdges);
  }

  /** 選択中のロングノーツを Tap 化 (LN除去)。 */
  function removeLnFromSelection(panel: Panel): void {
    const sel = panel.selection;
    if (sel.size === 0) return;
    if (![...sel].some((n) => n.type === 1)) return;
    pushUndo(panel);
    const newSel: Note[] = [];
    const notes = panel.notes.map((n) => {
      const copy: Note = { ...n };
      if (sel.has(n)) {
        if (copy.type === 1) {
          copy.type = 0;
          copy.dur = 0;
        }
        newSel.push(copy);
      }
      return copy;
    });
    setNotes(panel, notes, newSel);
  }

  /** 不可能配置(① LN中の単ノーツ / ② 同レーンほぼ同時)を正規化。種別ごとに move/delete。 */
  function normalizePanel(
    panel: Panel,
    opts: { lnOverlap: ResolveAction; duplicate: ResolveAction },
  ): NormalizeReport {
    const result = normalizeChart(panel.notes, {
      lnOverlap: opts.lnOverlap,
      duplicate: opts.duplicate,
      keyCount: panel.keyCount,
    });
    lastNormalize.value = result.report;
    if (result.report.moved > 0 || result.report.removed > 0) {
      pushUndo(panel);
      setNotes(panel, result.notes, []);
    }
    return result.report;
  }

  function copySelection(panel: Panel): void {
    if (panel.selection.size === 0) return;
    clipboard.value = copyNotes([...panel.selection]);
  }

  function pasteAt(panel: Panel, time: number, lane?: number): void {
    if (!clipboard.value) return;
    pushUndo(panel);
    const pasted = pasteNotes(clipboard.value, time, panel.keyCount, lane);
    const all = [...cloneNotes(panel.notes), ...pasted];
    setNotes(panel, all, pasted);
  }

  function undo(panel: Panel): void {
    const prev = panel.undoStack.pop();
    if (!prev) return;
    panel.redoStack.push(cloneNotes(panel.notes));
    panel.notes = markRaw(prev);
    panel.selection = markRaw(new Set());
    panel.edges = markRaw(new Map<Note, Edge>());
    panel.selectionVersion++;
    recompute(panel);
    bump(panel);
  }

  function redo(panel: Panel): void {
    const next = panel.redoStack.pop();
    if (!next) return;
    panel.undoStack.push(cloneNotes(panel.notes));
    panel.notes = markRaw(next);
    panel.selection = markRaw(new Set());
    panel.edges = markRaw(new Map<Note, Edge>());
    panel.selectionVersion++;
    recompute(panel);
    bump(panel);
  }

  // ---- 選択 ----
  function setSelection(panel: Panel, notes: Note[], edges?: Map<Note, Edge>): void {
    panel.selection = markRaw(new Set(notes));
    panel.edges = markRaw(edges ?? new Map<Note, Edge>());
    panel.selectionVersion++;
  }

  function clearSelection(panel: Panel): void {
    if (panel.selection.size === 0) return;
    panel.selection = markRaw(new Set());
    panel.edges = markRaw(new Map<Note, Edge>());
    panel.selectionVersion++;
  }

  // ---- パネル間移動 ----
  function moveNotesToPanel(
    from: Panel,
    to: Panel,
    notes: Note[],
    deltaTime: number,
    targetLane?: number,
  ): void {
    if (notes.length === 0 || from === to) return;
    pushUndo(from);
    pushUndo(to);
    // from から削除
    const del = new Set(notes);
    const fromNotes = from.notes.filter((n) => !del.has(n)).map((n) => ({ ...n }));
    // to へ挿入 (時間シフト + レーン制約)
    const clip = copyNotes(notes);
    const inserted = pasteNotes(clip, clip.anchorTime + deltaTime, to.keyCount, targetLane);
    const toNotes = [...cloneNotes(to.notes), ...inserted];
    setNotes(from, fromNotes, []);
    setNotes(to, toNotes, inserted);
  }

  // ---- 再生 ----
  function maxChartTime(): number {
    let max = 0;
    for (const p of panels.value) {
      const last = p.notes[p.notes.length - 1];
      if (last) max = Math.max(max, last.time + last.dur);
    }
    max = Math.max(max, audioEngine.musicDurationMs());
    return max;
  }

  function tick(): void {
    if (!isPlaying.value) return;
    currentTime.value = audioEngine.currentMs();
    if (currentTime.value >= maxChartTime()) {
      stopPlayback();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  async function startPlayback(): Promise<void> {
    const panel = playbackPanel();
    playStartTime = currentTime.value;
    audioEngine.setVolumes(musicVolume.value, seVolume.value);
    await audioEngine.play(currentTime.value, panel ? panel.notes : [], seEnabled.value);
    isPlaying.value = true;
    rafId = requestAnimationFrame(tick);
  }

  function stopPlayback(): void {
    const stoppedAt = audioEngine.currentMs();
    audioEngine.stop(false);
    isPlaying.value = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (returnOnStop.value) {
      currentTime.value = playStartTime;
      audioEngine.seek(playStartTime);
    } else {
      currentTime.value = stoppedAt;
    }
  }

  // ---- マーカー ----
  function toggleMarker(): void {
    const t = Math.round(currentTime.value);
    const eps = 5;
    const idx = markers.value.findIndex((m) => Math.abs(m - t) <= eps);
    if (idx >= 0) markers.value.splice(idx, 1);
    else {
      markers.value.push(t);
      markers.value.sort((a, b) => a - b);
    }
  }
  function clearMarkers(): void {
    markers.value = [];
  }
  function gotoMarker(dir: 1 | -1): void {
    const t = currentTime.value;
    if (dir > 0) {
      const m = markers.value.find((x) => x > t + 1);
      if (m !== undefined) seek(m);
    } else {
      for (let i = markers.value.length - 1; i >= 0; i--) {
        if (markers.value[i] < t - 1) {
          seek(markers.value[i]);
          break;
        }
      }
    }
  }

  async function togglePlay(): Promise<void> {
    if (isPlaying.value) stopPlayback();
    else await startPlayback();
  }

  function seek(ms: number): void {
    const clamped = Math.max(0, ms);
    currentTime.value = clamped;
    audioEngine.seek(clamped);
  }

  async function loadAudioFile(file: File): Promise<void> {
    await audioEngine.loadMusicFromFile(file);
    hasMusic.value = true;
  }

  async function loadAudioUrl(url: string): Promise<void> {
    await audioEngine.loadMusicFromUrl(url);
    hasMusic.value = true;
  }

  // ---- エクスポート ----
  function exportOsu(panel: Panel): string {
    const chart: Chart = {
      id: chartId(panel.notes),
      name: panel.name,
      format: 'osu',
      keyCount: panel.keyCount,
      notes: panel.notes,
      timing: panel.timing,
      audioFilename: panel.audioFilename,
      meta: panel.meta,
      difficulty: panel.difficulty,
    };
    return serializeOsu(chart);
  }

  function exportTxt(panel: Panel): string {
    const chart: Chart = {
      id: chartId(panel.notes),
      name: panel.name,
      format: 'txt',
      keyCount: panel.keyCount,
      notes: panel.notes,
      timing: panel.timing,
      difficulty: panel.difficulty,
    };
    return serializeTxt(chart);
  }

  function setTiming(panel: Panel, bpm: number, offsetMs: number): void {
    panel.timing = { ...panel.timing, bpm, offsetMs };
  }

  const snapDivisions = SNAP_DIVISIONS;

  return {
    // state
    panels,
    activePanelId,
    currentTime,
    pxPerMs,
    syncScroll,
    tool,
    snapIndex,
    noteSnap,
    chartAlign,
    isPlaying,
    playbackPanelId,
    seEnabled,
    musicVolume,
    seVolume,
    hasMusic,
    returnOnStop,
    markers,
    clipboard,
    lastNormalize,
    snapDivisions,
    // getters
    getPanel,
    activePanel,
    playbackPanel,
    // panel mgmt
    addChart,
    loadOsuText,
    loadTxtText,
    loadFiles,
    removePanel,
    newEmptyChart,
    // edit
    addNote,
    deleteNotes,
    deleteSelection,
    moveSelection,
    copySelection,
    pasteAt,
    removeLnFromSelection,
    normalizePanel,
    undo,
    redo,
    setSelection,
    clearSelection,
    moveNotesToPanel,
    setTiming,
    // playback
    togglePlay,
    startPlayback,
    stopPlayback,
    seek,
    loadAudioFile,
    loadAudioUrl,
    maxChartTime,
    // markers
    toggleMarker,
    clearMarkers,
    gotoMarker,
    // export
    exportOsu,
    exportTxt,
  };
});
