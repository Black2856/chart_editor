<script setup lang="ts">
import { computed } from 'vue';
import { useChartsStore } from '../stores/charts';
import EditorPanel from './EditorPanel.vue';

const store = useChartsStore();

// チャート全体の横位置 (首が疲れないよう中央寄せ等が選べる)。
// safe を付けてオーバーフロー時に先頭が隠れてスクロールできなくなるのを防ぐ。
const justify = computed(() => {
  switch (store.chartAlign) {
    case 'center':
      return 'safe center';
    case 'right':
      return 'safe flex-end';
    default:
      return 'flex-start';
  }
});
</script>

<template>
  <div class="compare">
    <div v-if="store.panels.length === 0" class="empty">
      <p>「譜面を開く」で .osu / .txt を読み込んで開始。</p>
      <p class="sub">複数開くと横並びで比較でき、スクロールと再生位置が同期します。</p>
    </div>
    <div v-else class="row" :style="{ justifyContent: justify }">
      <div v-for="p in store.panels" :key="p.id" class="cell">
        <EditorPanel :panel="p" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.compare {
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  background: #0a0c0f;
}
.row {
  display: flex;
  gap: 8px;
  height: 100%;
  padding: 8px;
  min-width: min-content;
}
.cell {
  height: 100%;
  flex: 0 0 auto;
}
.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6f7783;
  gap: 6px;
}
.empty .sub {
  font-size: 12px;
}
</style>
