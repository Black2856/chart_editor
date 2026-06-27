import type { Note } from '../core/types';
import { seNormalUrl } from '../assets';

// Web Audio による音楽 + SE 再生。
// 音楽は1トラック共有。SE は再生対象譜面のノーツから lookahead スケジューリング。

const LOOKAHEAD_MS = 150; // 先読み時間
const SCHED_INTERVAL_MS = 25; // スケジューラ間隔

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private musicBuffer: AudioBuffer | null = null;
  private seBuffer: AudioBuffer | null = null;

  private musicSource: AudioBufferSourceNode | null = null;
  private activeSe: AudioBufferSourceNode[] = [];
  private timer: number | null = null;

  private startCtxTime = 0; // 再生開始時の ctx.currentTime
  private startChartMs = 0; // 再生開始時の譜面時刻
  private playing = false;

  // 再生中に SE 対象として参照するノーツ列とスケジュール位置
  private seNotes: Note[] = [];
  private seIndex = 0;
  private seEnabled = true;
  private musicVolume = 1;
  private seVolume = 1;

  get isPlaying(): boolean {
    return this.playing;
  }

  get hasMusic(): boolean {
    return this.musicBuffer !== null;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.ctx;
  }

  async ensureSe(): Promise<void> {
    if (this.seBuffer) return;
    const ctx = this.ensureCtx();
    const res = await fetch(seNormalUrl);
    const buf = await res.arrayBuffer();
    this.seBuffer = await ctx.decodeAudioData(buf);
  }

  async loadMusicFromArrayBuffer(data: ArrayBuffer): Promise<void> {
    const ctx = this.ensureCtx();
    this.musicBuffer = await ctx.decodeAudioData(data.slice(0));
  }

  async loadMusicFromUrl(url: string): Promise<void> {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    await this.loadMusicFromArrayBuffer(buf);
  }

  async loadMusicFromFile(file: File): Promise<void> {
    const buf = await file.arrayBuffer();
    await this.loadMusicFromArrayBuffer(buf);
  }

  clearMusic(): void {
    this.stop();
    this.musicBuffer = null;
  }

  setVolumes(music: number, se: number): void {
    this.musicVolume = music;
    this.seVolume = se;
  }

  /** 現在の譜面時刻 (ms)。停止中は startChartMs。 */
  currentMs(): number {
    if (!this.playing || !this.ctx) return this.startChartMs;
    return this.startChartMs + (this.ctx.currentTime - this.startCtxTime) * 1000;
  }

  /** 音楽長さ (ms)。未ロードなら 0。 */
  musicDurationMs(): number {
    return this.musicBuffer ? this.musicBuffer.duration * 1000 : 0;
  }

  async play(fromMs: number, seNotes: Note[], seEnabled: boolean): Promise<void> {
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    if (seEnabled) await this.ensureSe();

    this.stop(false);

    this.seNotes = seNotes;
    this.seEnabled = seEnabled;
    this.startChartMs = Math.max(0, fromMs);

    // SE の開始位置を二分探索
    this.seIndex = this.lowerBound(seNotes, this.startChartMs);

    const when = ctx.currentTime + 0.08;
    this.startCtxTime = when;

    if (this.musicBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.musicBuffer;
      const gain = ctx.createGain();
      gain.gain.value = this.musicVolume;
      src.connect(gain).connect(ctx.destination);
      const offsetSec = this.startChartMs / 1000;
      if (offsetSec < this.musicBuffer.duration) {
        src.start(when, offsetSec);
      }
      this.musicSource = src;
      src.onended = () => {
        if (this.musicSource === src) this.handleMusicEnded();
      };
    }

    this.playing = true;
    this.timer = window.setInterval(() => this.schedule(), SCHED_INTERVAL_MS);
    this.schedule();
  }

  private handleMusicEnded(): void {
    // 自然終了 (再生位置が末尾に到達)。stop は呼び出し側の rAF が検知。
  }

  private schedule(): void {
    if (!this.playing || !this.ctx || !this.seEnabled || !this.seBuffer) return;
    const ctx = this.ctx;
    const horizonMs = this.currentMs() + LOOKAHEAD_MS;
    while (this.seIndex < this.seNotes.length && this.seNotes[this.seIndex].time <= horizonMs) {
      const note = this.seNotes[this.seIndex];
      const when = this.startCtxTime + (note.time - this.startChartMs) / 1000;
      if (when >= ctx.currentTime - 0.01) {
        const src = ctx.createBufferSource();
        src.buffer = this.seBuffer;
        const gain = ctx.createGain();
        gain.gain.value = this.seVolume;
        src.connect(gain).connect(ctx.destination);
        src.start(when);
        this.activeSe.push(src);
      }
      this.seIndex++;
    }
    // 終わったSE参照を間引き
    if (this.activeSe.length > 256) this.activeSe = this.activeSe.slice(-128);
  }

  stop(resetToStart = false): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const stoppedMs = this.currentMs();
    if (this.musicSource) {
      try {
        this.musicSource.onended = null;
        this.musicSource.stop();
      } catch {
        /* already stopped */
      }
      this.musicSource = null;
    }
    for (const s of this.activeSe) {
      try {
        s.stop();
      } catch {
        /* ignore */
      }
    }
    this.activeSe = [];
    this.playing = false;
    this.startChartMs = resetToStart ? 0 : stoppedMs;
  }

  /** 停止位置を明示設定 (シーク)。 */
  seek(ms: number): void {
    this.startChartMs = Math.max(0, ms);
  }

  private lowerBound(notes: Note[], time: number): number {
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

export const audioEngine = new AudioEngine();
