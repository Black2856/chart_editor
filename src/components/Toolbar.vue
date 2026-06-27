<script setup lang="ts">
import { computed, ref } from 'vue';
import { useChartsStore } from '../stores/charts';

const store = useChartsStore();
const chartInput = ref<HTMLInputElement | null>(null);
const audioInput = ref<HTMLInputElement | null>(null);

const songLength = computed(() => {
  // panels の変化に追従させるため依存を踏む
  void store.panels.length;
  void store.hasMusic;
  return Math.max(1000, store.maxChartTime());
});

function onSeekInput(e: Event): void {
  store.seek((e.target as HTMLInputElement).valueAsNumber);
}

function removeLn(): void {
  const p = store.activePanel();
  if (p) store.removeLnFromSelection(p);
}

const selCount = computed(() => store.activePanel()?.selection.size ?? 0);

async function onChartFiles(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;
  for (const file of Array.from(input.files)) {
    const text = await file.text();
    if (file.name.toLowerCase().endsWith('.osu')) store.loadOsuText(text, file.name);
    else store.loadTxtText(text, file.name);
  }
  input.value = '';
}

async function onAudioFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  if (!input.files || !input.files[0]) return;
  await store.loadAudioFile(input.files[0]);
  input.value = '';
}

function exportActive(format: 'osu' | 'txt'): void {
  const panel = store.activePanel();
  if (!panel) return;
  const text = format === 'osu' ? store.exportOsu(panel) : store.exportTxt(panel);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${panel.name.replace(/\.[^.]+$/, '')}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="toolbar">
    <!-- 1段目: ファイル・編集 -->
    <div class="bar">
      <div class="group">
        <span class="cap">ファイル</span>
        <button @click="chartInput?.click()">開く</button>
        <button @click="store.newEmptyChart(4)">新規4K</button>
        <input
          ref="chartInput"
          type="file"
          accept=".osu,.txt"
          multiple
          hidden
          @change="onChartFiles"
        />
      </div>

      <div class="group">
        <span class="cap">ツール</span>
        <button :class="{ on: store.tool === 'select' }" @click="store.tool = 'select'">選択</button>
        <button :class="{ on: store.tool === 'tap' }" @click="store.tool = 'tap'">Tap</button>
        <button :class="{ on: store.tool === 'long' }" @click="store.tool = 'long'">Long</button>
        <button :class="{ on: store.tool === 'delete' }" @click="store.tool = 'delete'">削除</button>
      </div>

      <div class="group">
        <span class="cap">スナップ</span>
        <select v-model.number="store.snapIndex">
          <option v-for="(d, i) in store.snapDivisions" :key="i" :value="i">{{ d.label }}</option>
        </select>
        <label class="chk"><input type="checkbox" v-model="store.noteSnap" />吸着</label>
      </div>

      <div class="group">
        <span class="cap">ズーム</span>
        <input class="zoom" type="range" min="0.05" max="2" step="0.01" v-model.number="store.pxPerMs" />
      </div>

      <div class="group">
        <span class="cap">選択 ({{ selCount }})</span>
        <button title="選択中のLNをTap化" :disabled="selCount === 0" @click="removeLn()">LN除去</button>
      </div>

      <div class="group">
        <span class="cap">表示位置</span>
        <button :class="{ on: store.chartAlign === 'left' }" title="チャートを左寄せ" @click="store.chartAlign = 'left'">左</button>
        <button :class="{ on: store.chartAlign === 'center' }" title="チャートを中央" @click="store.chartAlign = 'center'">中</button>
        <button :class="{ on: store.chartAlign === 'right' }" title="チャートを右寄せ" @click="store.chartAlign = 'right'">右</button>
      </div>

      <div class="group right">
        <span class="cap">出力 (選択中の譜面)</span>
        <button @click="exportActive('osu')">.osu</button>
        <button @click="exportActive('txt')">.txt</button>
      </div>
    </div>

    <!-- 2段目: 再生・サウンド・マーク -->
    <div class="bar">
      <div class="group">
        <span class="cap">再生</span>
        <button class="play" @click="store.togglePlay()">
          {{ store.isPlaying ? '⏸ 停止' : '▶ 再生' }}
        </button>
        <button @click="store.seek(0)">⏮ 先頭</button>
        <label class="chk"><input type="checkbox" v-model="store.seEnabled" />SE音</label>
        <label class="chk" title="停止したら再生を始めた位置に戻る">
          <input type="checkbox" v-model="store.returnOnStop" />停止で開始位置へ
        </label>
      </div>

      <div class="group">
        <span class="cap">音源</span>
        <button @click="audioInput?.click()">読込</button>
        <input ref="audioInput" type="file" accept="audio/*" hidden @change="onAudioFile" />
        <span class="status" :class="{ warn: !store.hasMusic }">{{ store.hasMusic ? '♪済' : '未読込' }}</span>
      </div>

      <div class="group">
        <span class="cap">音量</span>
        <span class="mini-lbl">曲</span>
        <input class="vol" type="range" min="0" max="1" step="0.01" v-model.number="store.musicVolume" />
        <span class="mini-lbl">SE</span>
        <input class="vol" type="range" min="0" max="1" step="0.01" v-model.number="store.seVolume" />
      </div>

      <div class="group">
        <span class="cap">マーカー ({{ store.markers.length }})</span>
        <button title="再生位置にマーカー追加/削除 (M)" @click="store.toggleMarker()">＋</button>
        <button title="前のマーカーへ" @click="store.gotoMarker(-1)">◀</button>
        <button title="次のマーカーへ" @click="store.gotoMarker(1)">▶</button>
        <button title="全マーカー消去" @click="store.clearMarkers()">消去</button>
      </div>
    </div>

    <!-- 3段目: シークバー -->
    <div class="bar seekrow">
      <span class="time">{{ (store.currentTime / 1000).toFixed(2) }}s</span>
      <input
        type="range"
        class="seek"
        min="0"
        :max="songLength"
        step="1"
        :value="store.currentTime"
        @input="onSeekInput"
      />
      <span class="time">{{ (songLength / 1000).toFixed(1) }}s</span>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px;
  background: #14171c;
  border-bottom: 1px solid #262b33;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  row-gap: 6px;
}
.group {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 12px;
  border-right: 1px solid #2a313b;
}
.group:first-child {
  padding-left: 0;
}
.group:last-child,
.group.right {
  border-right: none;
}
.group.right {
  margin-left: auto;
  padding-right: 0;
}
.cap {
  font-size: 10px;
  color: #6b7480;
  letter-spacing: 0.03em;
  margin-right: 2px;
  white-space: nowrap;
}
.mini-lbl {
  font-size: 11px;
  color: #8a93a0;
}
.status {
  font-size: 11px;
  color: #6fcf97;
}
.status.warn {
  color: #ff9a4c;
}
button {
  background: #232a33;
  border: 1px solid #333b45;
  color: #cdd3da;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
}
button:hover:not(:disabled) {
  background: #2c343f;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
button.on {
  background: #1d5a7a;
  border-color: #4cc4ff;
  color: #fff;
}
button.play {
  background: #1f7a3a;
  border-color: #2ecc71;
  color: #fff;
}
select,
input[type='range'] {
  background: #232a33;
  color: #cdd3da;
  border: 1px solid #333b45;
  border-radius: 4px;
  font-size: 12px;
}
.chk {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: #cdd3da;
  white-space: nowrap;
}
.zoom {
  width: 120px;
}
.vol {
  width: 68px;
}
.seekrow {
  flex-wrap: nowrap;
  gap: 8px;
  padding-top: 2px;
  border-top: 1px solid #21262d;
}
.time {
  font-size: 11px;
  color: #8a93a0;
  font-variant-numeric: tabular-nums;
  min-width: 48px;
}
.time:last-child {
  text-align: right;
}
.seek {
  flex: 1;
}
</style>
