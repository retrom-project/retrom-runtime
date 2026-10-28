/** A bounded stereo PCM queue shared by native cores and worker audio output. */
export class StereoPcmAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private next = 0;
  private volume = 1;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(private readonly rate: number, private readonly maximumSamples: number,
    private readonly errorCode: string) {}

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

  protected pushCore(core: {HEAP16: Int16Array}, count: number, pointer: () => number) {
    if (!this.context || this.context.state !== "running" || !count || !this.gain) {return;}
    if (count < 0 || count > this.maximumSamples || count % 2 !== 0) {throw new Error(this.errorCode);}
    const offset = pointer() / 2;
    if (!Number.isInteger(offset) || offset < 1 || offset + count > core.HEAP16.length) {
      throw new Error(this.errorCode);
    }
    this.pushSamples(core.HEAP16.subarray(offset, offset + count));
  }

  pushSamples(samples: Int16Array) {
    const context = this.context, count = samples.length;
    if (!context || context.state !== "running" || !count || !this.gain) {return;}
    if (count > this.maximumSamples || count % 2 !== 0) {throw new Error(this.errorCode);}
    const buffer = context.createBuffer(2, count / 2, this.rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {data[i] = samples[i * 2 + channel] / 32768;}
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
