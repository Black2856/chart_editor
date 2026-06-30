<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useChartsStore } from './stores/charts';
import { stepMs } from './core/snap';
import Toolbar from './components/Toolbar.vue';
import CompareView from './components/CompareView.vue';
import TimingPanel from './components/TimingPanel.vue';
import DifficultyPanel from './components/DifficultyPanel.vue';

const store = useChartsStore();

// ファイルのドラッグ&ドロップ読み込み (.osu/.txt 譜面・音源)
const dragActive = ref(false);
let dragDepth = 0;

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
}

function onDragEnter(e: DragEvent): void {
  if (!hasFiles(e)) return;
  dragDepth++;
  dragActive.value = true;
}

function onDragOver(e: DragEvent): void {
  if (!hasFiles(e)) return;
  e.preventDefault(); // drop を許可
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(): void {
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    dragActive.value = false;
  }
}

async function onDrop(e: DragEvent): Promise<void> {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dragActive.value = false;
  const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
  if (files.length) await store.loadFiles(files);
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable;
}

function snapStepMs(): number {
  const p = store.activePanel();
  if (!p) return 100;
  const s = stepMs(p.timing, store.snapStepBeats);
  return s > 0 ? s : 10; // フリー時は 10ms 単位で微調整
}

function onKey(e: KeyboardEvent): void {
  if (isTyping(e)) return;
  const panel = store.activePanel();

  if (e.code === 'Space') {
    e.preventDefault();
    store.togglePlay();
    return;
  }
  if (!panel) return;

  if (e.ctrlKey && e.key.toLowerCase() === 'c') {
    store.copySelection(panel);
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'v') {
    store.pasteAt(panel, store.currentTime);
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo(panel);
    else store.undo(panel);
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo(panel);
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    store.deleteSelection(panel);
    return;
  }
  if (e.key === '1') store.tool = 'select';
  else if (e.key === '2') store.tool = 'tap';
  else if (e.key === '3') store.tool = 'long';
  else if (e.key === '4') store.tool = 'delete';
  else if (e.key === 'm' || e.key === 'M') store.toggleMarker();

  // 選択ノーツの移動
  if (panel.selection.size > 0) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      store.moveSelection(panel, snapStepMs(), 0);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      store.moveSelection(panel, -snapStepMs(), 0);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      store.moveSelection(panel, 0, -1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      store.moveSelection(panel, 0, 1);
    }
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div
    class="app"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div v-if="dragActive" class="dropzone">
      <div class="dropmsg">ここにドロップして読み込み<small>譜面 (.osu / .txt) ・ 音源ファイル</small></div>
    </div>
    <header><strong>譜面エディター</strong></header>
    <Toolbar />
    <div class="body">
      <main><CompareView /></main>
      <aside>
        <TimingPanel />
        <div class="divider"></div>
        <DifficultyPanel />
        <div class="divider"></div>
        <div class="help">
          <h3>操作</h3>
          <ul>
            <li>ホイール: スクロール / Ctrl+ホイール: ズーム</li>
            <li>Tap/Long ツールでクリック配置 (Longはドラッグ)</li>
            <li>選択ツール: 矩形選択・ドラッグ移動・別パネルへドロップで移動</li>
            <li>LNの端をドラッグ or 端だけ矩形選択で、その端だけ伸縮</li>
            <li>Space 再生 / Del 削除 / Ctrl+C,V / Ctrl+Z,Y</li>
            <li>矢印キー: 選択を移動 (↑↓=スナップ, ←→=レーン)</li>
            <li>1選択 2Tap 3Long 4削除 / M=マーカー</li>
            <li>スナップ「フリー」で自由配置・自由移動。下のバーでシーク</li>
          </ul>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: relative;
}
.dropzone {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 14, 20, 0.72);
  border: 3px dashed #4cc4ff;
  pointer-events: none;
}
.dropmsg {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 20px;
  color: #e6e9ed;
  background: #14171c;
  border: 1px solid #2a313b;
  border-radius: 10px;
  padding: 28px 44px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.dropmsg small {
  font-size: 13px;
  color: #8a93a0;
}
header {
  padding: 6px 12px;
  background: #0e1014;
  border-bottom: 1px solid #262b33;
  font-size: 14px;
  color: #e6e9ed;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
main {
  flex: 1;
  min-width: 0;
}
aside {
  width: 280px;
  flex: 0 0 280px;
  background: #0e1116;
  border-left: 1px solid #262b33;
  overflow-y: auto;
}
.divider {
  height: 1px;
  background: #21262d;
}
.help {
  padding: 8px 10px;
}
.help h3 {
  margin: 0 0 6px;
  font-size: 13px;
  color: #cdd3da;
}
.help ul {
  margin: 0;
  padding-left: 16px;
}
.help li {
  font-size: 11px;
  color: #8a93a0;
  line-height: 1.6;
}
</style>
