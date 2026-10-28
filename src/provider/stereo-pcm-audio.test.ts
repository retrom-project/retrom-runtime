import {afterEach, expect, it, vi} from "vitest";
import {FantasyAudio} from "../fantasy-console/audio.js";
import {MameAudio} from "../mame/audio.js";
import {NXEngineAudio} from "../nxengine/audio.js";
import {Px68kAudio} from "../px68k/audio.js";
import {StereoPcmAudio} from "./stereo-pcm-audio.js";

type AudioCore = Parameters<FantasyAudio["push"]>[0] & Parameters<MameAudio["push"]>[0] &
  Parameters<NXEngineAudio["push"]>[0] & Parameters<Px68kAudio["push"]>[0];
const variants = [
  {name: "fantasy", Audio: FantasyAudio, limit: 4096, code: "FANTASY_AUDIO_INVALID"},
  {name: "mame", Audio: MameAudio, limit: 8192, code: "MAME_AUDIO_INVALID"},
  {name: "nxengine", Audio: NXEngineAudio, limit: 4096, code: "NXENGINE_AUDIO_INVALID"},
  {name: "px68k", Audio: Px68kAudio, limit: 4096, code: "PX68K_AUDIO_INVALID"},
];
afterEach(() => vi.unstubAllGlobals());

function environment() {
  const gain = {gain: {value: 1}, connect: vi.fn()};
  const buffers: {rate: number; channels: Float32Array[]}[] = [];
  const sources: {buffer: AudioBuffer | null; onended: (() => void) | null;
    connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>}[] = [];
  const context = {
    currentTime: 0, state: "running", destination: {},
    createGain: () => gain,
    createBuffer: (count: number, length: number, rate: number) => {
      const channels = Array.from({length: count}, () => new Float32Array(length));
      buffers.push({rate, channels});
      return {duration: length / rate, getChannelData: (channel: number) => channels[channel]};
    },
    createBufferSource: () => {
      const source = {buffer: null, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn()};
      sources.push(source); return source;
    },
    resume: vi.fn(async () => {context.state = "running";}),
    suspend: vi.fn(async () => {context.state = "suspended";}), close: vi.fn(async () => undefined),
  };
  const create = vi.fn(function () {return context;});
  vi.stubGlobal("AudioContext", create);
  return {context, gain, buffers, sources, create};
}

function nativeAudio() {
  const count = vi.fn(() => 4), pointer = vi.fn(() => 2);
  const core = {HEAP16: Int16Array.of(0, 32767, -32768, 16384, -16384),
    _retrom_audio_count: count, _retrom_audio: pointer,
    _retrom_mame_audio_count: count, _retrom_mame_audio: pointer};
  return {core: core as unknown as AudioCore, count, pointer};
}

it.each(variants)("$name preserves stereo samples, volume and pause/stop ownership", async ({Audio}) => {
  const env = environment(), {core} = nativeAudio(), audio = new Audio(22050);
  audio.push(core);
  expect(env.create).not.toHaveBeenCalled();
  audio.setVolume(.25); await audio.resume(); audio.push(core);
  expect(env.gain.gain.value).toBe(.25);
  expect(env.buffers[0].rate).toBe(22050);
  expect([...env.buffers[0].channels[0]]).toEqual([32767 / 32768, .5]);
  expect([...env.buffers[0].channels[1]]).toEqual([-1, -.5]);
  expect(env.sources[0].start).toHaveBeenCalledWith(.01);
  audio.setVolume(2); expect(env.gain.gain.value).toBe(1);
  audio.setVolume(-1); expect(env.gain.gain.value).toBe(0);
  await audio.pause(); audio.push(core);
  expect(env.sources).toHaveLength(1);
  expect(env.sources[0].stop).toHaveBeenCalledOnce();
  expect(env.sources[0].disconnect).toHaveBeenCalledOnce();
  await audio.stop();
  expect(env.context.close).toHaveBeenCalledOnce();
  await audio.stop(); expect(env.context.close).toHaveBeenCalledOnce();
});

it.each(variants)("$name preserves heap checks, sample limits and its error code", async ({Audio, limit, code}) => {
  environment();
  const audio = new Audio(44100), {core, count, pointer} = nativeAudio();
  await audio.resume();
  for (const invalid of [-2, 3, limit + 2]) {
    count.mockReturnValue(invalid);
    expect(() => audio.push(core)).toThrow(code);
  }
  expect(pointer).not.toHaveBeenCalled();
  count.mockReturnValue(4);
  for (const invalid of [0, -2, 1, core.HEAP16.byteLength]) {
    pointer.mockReturnValue(invalid);
    expect(() => audio.push(core)).toThrow(code);
  }
  pointer.mockReturnValue(2); count.mockReturnValue(limit);
  core.HEAP16 = new Int16Array(limit + 1);
  expect(() => audio.push(core)).not.toThrow();
  expect(() => audio.pushSamples(new Int16Array(limit + 2))).toThrow(code);
  expect(() => audio.pushSamples(new Int16Array(3))).toThrow(code);
  await audio.stop();
});

it("caps queued time, catches up to the audio clock, and releases only live sources", async () => {
  const env = environment(), audio = new StereoPcmAudio(10, 100, "AUDIO_INVALID");
  await audio.resume();
  audio.pushSamples(new Int16Array(100)); audio.pushSamples(new Int16Array(100));
  expect(env.sources[1].start).toHaveBeenCalledWith(.15);
  env.context.currentTime = 10;
  audio.pushSamples(Int16Array.of(1, -1));
  expect(env.sources[2].start).toHaveBeenCalledWith(10.01);
  env.sources[0].onended?.();
  await audio.stop();
  expect(env.sources[0].stop).not.toHaveBeenCalled();
  expect(env.sources[0].disconnect).toHaveBeenCalledOnce();
  expect(env.sources[1].stop).toHaveBeenCalledOnce();
  expect(env.sources[2].stop).toHaveBeenCalledOnce();
});
