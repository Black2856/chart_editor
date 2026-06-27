<script setup lang="ts">
import { computed } from 'vue';
import { useChartsStore } from '../stores/charts';

const store = useChartsStore();
const panel = computed(() => store.activePanel());
const diff = computed(() => panel.value?.difficulty);

const bars = computed(() => {
  const d = diff.value?.difficulty;
  if (!d) return [];
  const entries: [string, number][] = [
    ['密度', d.density],
    ['縦連', d.jack],
    ['トリル', d.trill],
    ['同時押し', d.chord],
    ['LN', d.ln],
    ['移動', d.movement],
    ['リズム', d.rhythm],
  ];
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return entries.map(([label, v]) => ({ label, v, pct: (v / max) * 100 }));
});
</script>

<template>
  <div class="dp">
    <h3>難易度指数</h3>
    <div v-if="diff">
      <div class="overall">
        <span class="star">★ {{ diff.star.toFixed(1) }}</span>
        <span class="ov">overall {{ diff.overall }} (star=overall÷3)</span>
      </div>
      <div class="stats">
        <span>notes {{ diff.stats.totalNotes }}</span>
        <span>{{ diff.stats.durationSec }}s</span>
        <span>avg {{ diff.stats.avgNps }}nps</span>
        <span>max {{ diff.stats.maxNps }}nps</span>
        <span>peak {{ diff.stats.peakNps }}nps</span>
      </div>
      <div class="bars">
        <div v-for="b in bars" :key="b.label" class="bar-row">
          <span class="bl">{{ b.label }}</span>
          <div class="track"><div class="fill" :style="{ width: b.pct + '%' }"></div></div>
          <span class="bv">{{ b.v }}</span>
        </div>
      </div>
      <p class="hint">休憩区間に引っ張られないピーク集約。値は編集に追従して再計算。</p>
    </div>
    <p v-else class="hint">譜面を選択してください。</p>
  </div>
</template>

<style scoped>
.dp {
  padding: 8px 10px;
}
h3 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #cdd3da;
}
.overall {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}
.star {
  font-size: 20px;
  color: #ffd24c;
  font-weight: 700;
}
.ov {
  font-size: 12px;
  color: #8a93a0;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: #8a93a0;
  margin-bottom: 8px;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.bl {
  width: 56px;
  font-size: 11px;
  color: #aeb6c0;
}
.track {
  flex: 1;
  height: 9px;
  background: #1d2129;
  border-radius: 4px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: linear-gradient(90deg, #4cc4ff, #ff7ab3);
}
.bv {
  width: 40px;
  text-align: right;
  font-size: 11px;
  color: #8a93a0;
}
.hint {
  font-size: 11px;
  color: #6f7783;
  margin: 8px 0 0;
  line-height: 1.5;
}
</style>
