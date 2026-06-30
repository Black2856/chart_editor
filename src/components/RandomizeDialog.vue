<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useChartsStore } from '../stores/charts';
import { NEUTRAL_BIAS } from '../core/randomize';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const store = useChartsStore();

const panelName = computed(() => store.activePanel()?.name ?? null);
const selCount = computed(() => store.activePanel()?.selection.size ?? 0);
const scopeLabel = computed(() => (selCount.value > 0 ? `選択 ${selCount.value} ノーツ` : '譜面全体'));

function close(): void {
  emit('update:modelValue', false);
}

function reset(): void {
  store.randomizeBias = { ...NEUTRAL_BIAS };
}

function run(): void {
  const p = store.activePanel();
  if (p) store.randomizePanel(p);
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) window.addEventListener('keydown', onKey);
    else window.removeEventListener('keydown', onKey);
  },
);
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="modelValue" class="overlay" @click.self="close">
    <div class="modal" role="dialog" aria-modal="true">
      <header>
        <h2>ランダム配置</h2>
        <button class="x" title="閉じる" @click="close">✕</button>
      </header>

      <p class="target">
        対象:
        <strong v-if="panelName">{{ panelName }} <span class="scope">({{ scopeLabel }})</span></strong>
        <span v-else class="warn">譜面が選択されていません</span>
      </p>

      <p class="note">
        重なりを避けつつレーンを振り直します。下の傾向に「寄せて」抽選します (0=純ランダム)。
      </p>

      <div class="row">
        <div class="label">
          ジャック (同レーン連打)
          <small>− 避ける ／ ＋ 増やす</small>
        </div>
        <div class="ctl">
          <input type="range" min="-1" max="1" step="0.1" v-model.number="store.randomizeBias.jack" />
          <span class="val">{{ store.randomizeBias.jack.toFixed(1) }}</span>
        </div>
      </div>

      <div class="row">
        <div class="label">
          流れ (階段・ストリーム)
          <small>＋ 隣接レーンへ流れやすく</small>
        </div>
        <div class="ctl">
          <input type="range" min="-1" max="1" step="0.1" v-model.number="store.randomizeBias.stream" />
          <span class="val">{{ store.randomizeBias.stream.toFixed(1) }}</span>
        </div>
      </div>

      <div class="row">
        <div class="label">
          和音の広がり
          <small>− 密 (隣接) ／ ＋ 広げる</small>
        </div>
        <div class="ctl">
          <input
            type="range"
            min="-1"
            max="1"
            step="0.1"
            v-model.number="store.randomizeBias.chordSpread"
          />
          <span class="val">{{ store.randomizeBias.chordSpread.toFixed(1) }}</span>
        </div>
      </div>

      <div class="row">
        <div class="label">
          レーン均等化
          <small>使うレーンの偏りを減らす (散らす)</small>
        </div>
        <div class="ctl">
          <input type="range" min="0" max="1" step="0.1" v-model.number="store.randomizeBias.balance" />
          <span class="val">{{ store.randomizeBias.balance.toFixed(1) }}</span>
        </div>
      </div>

      <footer>
        <button class="ghost" @click="reset">中立に戻す</button>
        <button class="ghost" @click="close">閉じる</button>
        <button class="primary" :disabled="!panelName" @click="run">実行 (Undo可)</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: 440px;
  max-width: calc(100vw - 32px);
  background: #14171c;
  border: 1px solid #2a313b;
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  padding: 14px 16px 16px;
  color: #cdd3da;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
h2 {
  margin: 0;
  font-size: 15px;
  color: #e6e9ed;
}
.x {
  background: transparent;
  border: none;
  color: #8a93a0;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
}
.x:hover {
  color: #e6e9ed;
}
.target {
  font-size: 12px;
  color: #8a93a0;
  margin: 0 0 8px;
}
.target strong {
  color: #cdd3da;
}
.target .scope {
  color: #4cc4ff;
  font-weight: 600;
}
.target .warn {
  color: #ff9a4c;
}
.note {
  font-size: 11px;
  color: #6b7480;
  margin: 0 0 6px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid #21262d;
}
.label {
  display: flex;
  flex-direction: column;
  font-size: 13px;
  color: #e6e9ed;
}
.label small {
  font-size: 11px;
  color: #6b7480;
  margin-top: 2px;
}
.ctl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.ctl input[type='range'] {
  width: 150px;
  background: #232a33;
  border: 1px solid #333b45;
  border-radius: 4px;
}
.val {
  font-size: 12px;
  color: #cdd3da;
  font-variant-numeric: tabular-nums;
  min-width: 28px;
  text-align: right;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
footer button {
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  padding: 6px 14px;
}
.ghost {
  background: #232a33;
  border: 1px solid #333b45;
  color: #cdd3da;
}
.ghost:hover {
  background: #2c343f;
}
.primary {
  background: #1f7a3a;
  border: 1px solid #2ecc71;
  color: #fff;
}
.primary:hover:not(:disabled) {
  background: #259148;
}
.primary:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
