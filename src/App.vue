<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';
import { useChartsStore } from './stores/charts';
import { stepMs } from './core/snap';
import Toolbar from './components/Toolbar.vue';
import CompareView from './components/CompareView.vue';
import TimingPanel from './components/TimingPanel.vue';
import DifficultyPanel from './components/DifficultyPanel.vue';

const store = useChartsStore();

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable;
}

function snapStepMs(): number {
  const p = store.activePanel();
  if (!p) return 100;
  const div = store.snapDivisions[store.snapIndex];
  const s = stepMs(p.timing, div.stepBeats);
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
  <div class="app">
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
