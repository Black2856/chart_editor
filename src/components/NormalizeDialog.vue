<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useChartsStore } from '../stores/charts';
import type { ResolveAction } from '../core/normalize';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const store = useChartsStore();

// ①LN中の単ノーツ / ②同レーンほぼ同時 を種別ごとに move/delete
const lnOverlap = ref<ResolveAction>('move');
const duplicate = ref<ResolveAction>('move');

const panelName = computed(() => store.activePanel()?.name ?? null);
const report = computed(() => store.lastNormalize);

function close(): void {
  emit('update:modelValue', false);
}

function run(): void {
  const p = store.activePanel();
  if (!p) return;
  store.normalizePanel(p, { lnOverlap: lnOverlap.value, duplicate: duplicate.value });
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}

// 開閉に合わせて前回結果をクリア・Esc ハンドラを着脱
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      store.lastNormalize = null;
      window.addEventListener('keydown', onKey);
    } else {
      window.removeEventListener('keydown', onKey);
    }
  },
);
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="modelValue" class="overlay" @click.self="close">
    <div class="modal" role="dialog" aria-modal="true">
      <header>
        <h2>不可能配置の正規化</h2>
        <button class="x" title="閉じる" @click="close">✕</button>
      </header>

      <p class="target">
        対象:
        <strong v-if="panelName">{{ panelName }}</strong>
        <span v-else class="warn">譜面が選択されていません</span>
      </p>

      <div class="row">
        <div class="label">
          <span class="num">①</span> ロングノーツ中の単ノーツ
          <small>LN を押している間に同じレーンへ置かれた単ノーツ</small>
        </div>
        <div class="seg">
          <button :class="{ on: lnOverlap === 'move' }" @click="lnOverlap = 'move'">別レーンへ移動</button>
          <button :class="{ on: lnOverlap === 'delete' }" @click="lnOverlap = 'delete'">削除</button>
        </div>
      </div>

      <div class="row">
        <div class="label">
          <span class="num">②</span> 同レーンの重複
          <small>ほぼ同じタイミングで同レーンに重なるノーツ</small>
        </div>
        <div class="seg">
          <button :class="{ on: duplicate === 'move' }" @click="duplicate = 'move'">別レーンへ移動</button>
          <button :class="{ on: duplicate === 'delete' }" @click="duplicate = 'delete'">削除</button>
        </div>
      </div>

      <p class="note">「別レーンへ移動」で空きレーンが無い場合は削除されます。</p>

      <p v-if="report" class="result">
        <template v-if="report.duplicates === 0 && report.lnOverlaps === 0">
          ✓ 問題は見つかりませんでした。
        </template>
        <template v-else>
          ① {{ report.lnOverlaps }}件 / ② {{ report.duplicates }}件 を検出 →
          移動 {{ report.moved }} ・ 削除 {{ report.removed }}
        </template>
      </p>

      <footer>
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
  margin: 0 0 12px;
}
.target strong {
  color: #cdd3da;
}
.target .warn {
  color: #ff9a4c;
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
.num {
  color: #4cc4ff;
  font-weight: 600;
}
.seg {
  display: flex;
  gap: 0;
  flex: 0 0 auto;
}
.seg button {
  background: #232a33;
  border: 1px solid #333b45;
  color: #cdd3da;
  cursor: pointer;
  font-size: 12px;
  padding: 5px 9px;
  white-space: nowrap;
}
.seg button:first-child {
  border-radius: 4px 0 0 4px;
}
.seg button:last-child {
  border-radius: 0 4px 4px 0;
  border-left: none;
}
.seg button:hover {
  background: #2c343f;
}
.seg button.on {
  background: #1d5a7a;
  border-color: #4cc4ff;
  color: #fff;
}
.note {
  font-size: 11px;
  color: #6b7480;
  margin: 10px 0 0;
}
.result {
  font-size: 12px;
  color: #6fcf97;
  background: #11261c;
  border: 1px solid #1f4733;
  border-radius: 4px;
  padding: 6px 8px;
  margin: 10px 0 0;
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
