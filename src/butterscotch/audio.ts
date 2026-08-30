type AudioWindow = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

export type ButterscotchAudio = {
  readonly sampleRate: number;
  close: () => Promise<void>;
  enqueue: (samples: Float32Array) => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  setVolume: (volume: number) => void;
};

const bufferFrames = 2_048;
const maximumQueuedSeconds = 2;

export function createButterscotchAudio(frameWindow: Window): ButterscotchAudio | null {
  const audioWindow = frameWindow as AudioWindow;
  const Constructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!Constructor) {return null;}
  const context = new Constructor();
  const gain = context.createGain();
  const processor = context.createScriptProcessor(bufferFrames, 0, 2);
  const queue: Float32Array[] = [];
  let queuedSamples = 0;
  let headOffset = 0;
  let closed = false;
  processor.onaudioprocess = (event) => {
    const left = event.outputBuffer.getChannelData(0);
    const right = event.outputBuffer.getChannelData(1);
    left.fill(0);
    right.fill(0);
    let frame = 0;
    while (frame < left.length && queue.length) {
      const current = queue[0];
      const availableFrames = (current.length - headOffset) / 2;
      const count = Math.min(left.length - frame, availableFrames);
      for (let index = 0; index < count; index += 1) {
        left[frame + index] = current[headOffset + index * 2];
        right[frame + index] = current[headOffset + index * 2 + 1];
      }
      const consumed = count * 2;
      frame += count;
      headOffset += consumed;
      queuedSamples -= consumed;
      if (headOffset === current.length) {queue.shift(); headOffset = 0;}
    }
  };
  processor.connect(gain);
  gain.connect(context.destination);
  return {
    sampleRate: context.sampleRate,
    close: async () => {
      if (closed) {return;}
      closed = true;
      queue.length = 0;
      queuedSamples = 0;
      processor.disconnect();
      gain.disconnect();
      await context.close();
    },
    enqueue: (samples) => {
      if (closed || samples.length === 0 || samples.length % 2 !== 0) {return;}
      queue.push(samples.slice());
      queuedSamples += samples.length;
      const maximumSamples = context.sampleRate * maximumQueuedSeconds * 2;
      while (queuedSamples > maximumSamples && queue.length > 1) {
        const removed = queue.shift();
        if (removed) {queuedSamples -= removed.length - headOffset;}
        headOffset = 0;
      }
    },
    pause: async () => {if (!closed && context.state === "running") {await context.suspend();}},
    resume: async () => {if (!closed && context.state !== "running") {await context.resume();}},
    setVolume: (volume) => {gain.gain.value = Math.min(1, Math.max(0, volume));},
  };
}
