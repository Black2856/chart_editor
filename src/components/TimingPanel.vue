<script setup lang="ts">
import { computed } from 'vue';
import { useChartsStore } from '../stores/charts';

const store = useChartsStore();
const panel = computed(() => store.activePanel());

function setBpm(v: number): void {
  const p = panel.value;
  if (!p || !Number.isFinite(v) || v <= 0) return;
  store.setTiming(p, v, p.timing.offsetMs);
}
function setOffset(v: number): void {
  const p = panel.value;
  if (!p || !Number.isFinite(v)) return;
  store.setTiming(p, p.timing.bpm, v);
}
function setOffsetToPlayhead(): void {
  const p = panel.value;
  if (!p) return;
  store.setTiming(p, p.timing.bpm, Math.round(store.currentTime));
}
</script>

<template>
  <div class="tp">
    <h3>タイミング</h3>
    <div v-if="panel">
      <div class="field">
        <label>BPM</label>
        <input
          type="number"
          step="0.001"
          :value="panel.timing.bpm"
          @change="setBpm(($event.target as HTMLInputElement).valueAsNumber)"
        />
      </div>
      <div class="field">
        <label>オフセット(ms)</label>
        <input
          type="number"
          step="1"
          :value="panel.timing.offsetMs"
          @change="setOffset(($event.target as HTMLInputElement).valueAsNumber)"
        />
      </div>
      <button class="full" @click="setOffsetToPlayhead">再生位置をオフセットに</button>
      <p class="hint">
        txt は拍情報を持たないため、ここで BPM / オフセットを設定するとスナップグリッドが出ます。
      </p>
    </div>
    <p v-else class="hint">譜面を選択してください。</p>
  </div>
</template>

<style scoped>
.tp {
  padding: 8px 10px;
}
h3 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #cdd3da;
}
.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
label {
  font-size: 12px;
  color: #8a93a0;
}
input[type='number'] {
  width: 110px;
  background: #232a33;
  color: #e6e9ed;
  border: 1px solid #333b45;
  border-radius: 4px;
  padding: 3px 5px;
  font-size: 12px;
}
button.full {
  width: 100%;
  margin-top: 4px;
  background: #232a33;
  border: 1px solid #333b45;
  color: #cdd3da;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  padding: 5px;
}
.hint {
  font-size: 11px;
  color: #6f7783;
  margin: 8px 0 0;
  line-height: 1.5;
}
</style>
