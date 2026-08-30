import { describe, expect, it, vi } from "vitest";

import { createButterscotchAudio } from "./audio.js";

describe("Butterscotch browser audio", () => {
  it("deinterleaves bounded worker PCM and controls the host context", async () => {
    const left = new Float32Array(3);
    const right = new Float32Array(3);
    const context = new FakeAudioContext(left, right);
    const frameWindow = { AudioContext: class {constructor() {return context;}} } as unknown as Window;
    const audio = createButterscotchAudio(frameWindow);
    if (!audio) {throw new Error("audio unavailable");}

    audio.enqueue(Float32Array.of(0.1, 0.2, 0.3, 0.4));
    context.processor.onaudioprocess?.call(context.processor as unknown as ScriptProcessorNode, {
      outputBuffer: {getChannelData: (channel: number) => channel === 0 ? left : right},
    } as AudioProcessingEvent);
    expect([...left]).toEqual([expect.closeTo(0.1), expect.closeTo(0.3), 0]);
    expect([...right]).toEqual([expect.closeTo(0.2), expect.closeTo(0.4), 0]);

    audio.setVolume(3);
    expect(context.gain.gain.value).toBe(1);
    await audio.resume();
    await audio.pause();
    await audio.close();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.suspend).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("treats a browser-closed context as already cleaned up", async () => {
    const context = new FakeAudioContext(new Float32Array(1), new Float32Array(1));
    context.state = "closed";
    context.close.mockRejectedValueOnce(new DOMException("Cannot close a closed AudioContext.", "InvalidStateError"));
    const frameWindow = { AudioContext: class {constructor() {return context;}} } as unknown as Window;
    const audio = createButterscotchAudio(frameWindow);
    if (!audio) {throw new Error("audio unavailable");}

    await expect(audio.close()).resolves.toBeUndefined();
    expect(context.close).not.toHaveBeenCalled();
  });

  it("tolerates the context closing while cleanup is in progress", async () => {
    const context = new FakeAudioContext(new Float32Array(1), new Float32Array(1));
    context.close.mockRejectedValueOnce(Object.assign(Object.create(null), {name: "InvalidStateError"}));
    const frameWindow = { AudioContext: class {constructor() {return context;}} } as unknown as Window;
    const audio = createButterscotchAudio(frameWindow);
    if (!audio) {throw new Error("audio unavailable");}

    await expect(audio.close()).resolves.toBeUndefined();
    expect(context.close).toHaveBeenCalledOnce();
  });
});

class FakeAudioContext {
  readonly sampleRate = 48_000;
  readonly destination = {} as AudioDestinationNode;
  readonly resume = vi.fn(async () => {this.state = "running" as AudioContextState;});
  readonly suspend = vi.fn(async () => {this.state = "suspended" as AudioContextState;});
  readonly close = vi.fn(async () => {this.state = "closed" as AudioContextState;});
  readonly gain = {connect: vi.fn(), disconnect: vi.fn(), gain: {value: 1}};
  readonly processor = {connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as ScriptProcessorNode["onaudioprocess"]};
  state: AudioContextState = "suspended";
  constructor(_left: Float32Array, _right: Float32Array) {}
  createGain() {return this.gain as unknown as GainNode;}
  createScriptProcessor() {return this.processor as unknown as ScriptProcessorNode;}
}
