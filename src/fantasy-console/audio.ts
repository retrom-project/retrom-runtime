import type {NativeCore} from "./core.js";
export class FantasyAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private next = 0;
  private volume = 1;
  private sources = new Set<AudioBufferSourceNode>();
  constructor(private readonly rate: number) {}
  async resume() {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    await this.context.resume();
    this.next = Math.max(this.next, this.context.currentTime);
  }
  push(core: NativeCore) {
    const context = this.context;
    const count = core._retrom_audio_count();
    if (!context || context.state !== "running" || !count || !this.gain) {return;}
    if (count < 0 || count > 4096 || count % 2 !== 0) {throw new Error("FANTASY_AUDIO_INVALID");}
    const offset = core._retrom_audio() / 2;
    if (!Number.isInteger(offset) || offset < 1 || offset + count > core.HEAP16.length) {
      throw new Error("FANTASY_AUDIO_INVALID");
    }
    const buffer = context.createBuffer(2, count / 2, this.rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {data[i] = core.HEAP16[offset + i * 2 + channel] / 32768;}
    }
    const source = context.createBufferSource();
    source.buffer = buffer; source.connect(this.gain);
    source.onended = () => {source.disconnect(); this.sources.delete(source);};
    this.sources.add(source);
    this.next = Math.max(context.currentTime + .01, Math.min(this.next, context.currentTime + .15));
    source.start(this.next); this.next += buffer.duration;
  }
  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.gain) {this.gain.gain.value = this.volume;}
  }
  async pause() {
    for (const source of this.sources) {source.onended = null; source.stop(); source.disconnect();}
    this.sources.clear();
    await this.context?.suspend();
  }
  async stop() {
    await this.pause(); await this.context?.close(); this.context = null; this.gain = null;
  }
}
