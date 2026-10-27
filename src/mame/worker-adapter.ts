import type {MountedRuntimeAdapter} from "../internal-adapter.js";
import type {ContentSessionClient} from "../content-io/client.js";
import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";
import {verifiedContentAsset} from "../content-io/bootstrap.js";
import {fileContentSource, type AdapterContentOptions} from "../provider/content-inputs.js";
import {withStartupTask} from "../provider/startup.js";
import {prepareMameCore, type MameParameters} from "./core.js";
import {prepareArcadeFiles} from "./files.js";
import {installInput} from "./input.js";
import {mameTouchGamepad} from "./touch-gamepad.js";
import {MameAudio} from "./audio.js";
import {captureVideo} from "./video.js";
import {checkpointFormat, checkpointLimit, decodeState, encodeState} from "./state.js";
import {MameWorkerClient} from "./worker-client.js";
import {decodeWorkerState, encodeWorkerState, type MameWorkerState} from "./worker-state.js";
import type {MameFrame, MameInputEvent, MameWorkerBoot} from "./worker.js";

export async function mountMameWorker(config: Extract<MameParameters, {arcade: true}>, target: HTMLElement, win: Window,
  restorePayload: Uint8Array | null, content: AdapterContentOptions): Promise<MountedRuntimeAdapter> {
  const session = content.contentSession as AdapterContentOptions["contentSession"] & Partial<Pick<ContentSessionClient, "createSyncChannel">>;
  if (!session.createSyncChannel || !config.media?.length || config.media.length > 8) {throw new Error("MAME_CONTENT_INVALID");}
  content.signal?.throwIfAborted();
  const readers: ContentReaderV1[] = [], urls: string[] = [];
  const client = new MameWorkerClient(), canvas = win.document.createElement("canvas");
  canvas.tabIndex = 0; canvas.setAttribute("aria-label", `MAME Arcade (${config.machine})`);
  let audio: MameAudio | undefined, input: ReturnType<typeof installInput> | undefined;
  let stopped = false, paused = false, animation = 0, frameCount = 1, lastTime = 0, accumulator = 0;
  let state: MameFrame, identity: string, build: string;
  const events: MameInputEvent[] = [];
  const active = () => {if (stopped) {throw new Error("MAME_RUNTIME_STOPPED");}};
  const unlock = () => {if (!stopped && !paused) {void audio?.resume().catch(() => undefined);}};
  const exit = async () => {
    if (stopped) {return;} stopped = true; win.cancelAnimationFrame(animation); input?.stop();
    content.signal?.removeEventListener("abort", abort); win.removeEventListener("pointerdown", unlock); win.removeEventListener("keydown", unlock);
    await Promise.allSettled(readers.map(reader => reader.close()));
    try {await client.request("STOP", null, [], 2000);} catch { /* Closing content already wakes blocked native reads. */ }
    client.close(); for (const url of urls.splice(0)) {URL.revokeObjectURL(url);} canvas.remove(); await audio?.stop();
  };
  const abort = () => {void exit();};
  try {
    const core = await prepareMameCore(config, content);
    build = core.manifest.build;
    const prepared = await prepareArcadeFiles(config, content); identity = prepared.identity;
    const media: MameWorkerBoot["media"] = [];
    for (const file of config.media) {
      const policy = session.inputPolicy("media");
      const reader = await session.open(fileContentSource(file, policy), policy, content.signal); readers.push(reader);
      media.push({path: file.virtualPath, size: file.sizeBytes, channel: await session.createSyncChannel(reader.id)});
    }
    const syncURL = URL.createObjectURL(await verifiedContentAsset(new URL(config.runtimeBaseUrl, globalThis.location?.href).href,
      content.assetIndex, "sync-client.mjs", content.signal)); urls.push(syncURL);
    const offscreen = canvas.transferControlToOffscreen();
    const restore = restorePayload ? decodeWorkerState(await decodeState(identity, build, restorePayload)) : null;
    const payload: MameWorkerBoot = {code: core.loaded[0], wasm: core.loaded[1], family: core.loaded[2], build, assetBaseURL: core.base.href,
      files: prepared.files, canvas: offscreen, syncClientURL: syncURL, media, restore, maxStateBytes: checkpointLimit - 108};
    const buffers = [...core.loaded, ...prepared.files.map(file => file.bytes), ...(restore ? [restore.native, ...restore.files.map(file => file.bytes)] : [])].map(bytes => bytes.buffer as ArrayBuffer);
    content.signal?.throwIfAborted(); active();
    content.signal?.addEventListener("abort", abort, {once: true});
    state = await withStartupTask(content.startup, "CORE_INITIALIZATION", () => client.request<MameFrame>("BOOT", payload,
      [...new Set(buffers), offscreen, ...media.map(file => file.channel.port)]));
    validateFrame(state);
    audio = new MameAudio(state.rate);
    input = installInput(win, {
      _retrom_mame_key: (id, down) => events.push(["_retrom_mame_key", id, down]),
      _retrom_mame_button: (id, down) => events.push(["_retrom_mame_button", id, down]),
      _retrom_mame_axis: (id, value) => events.push(["_retrom_mame_axis", id, value]),
    }, config.machine, true);
    active(); target.append(canvas); canvas.focus();
    win.addEventListener("pointerdown", unlock); win.addEventListener("keydown", unlock); unlock();
    animation = win.requestAnimationFrame(time => {void tick(time);});
  } catch (error) {await exit(); throw error;}
  async function tick(time: number) {
    if (stopped || paused) {return;}
    accumulator += Math.min(100, lastTime ? time - lastTime : 1000 / state.fps); lastTime = time;
    const count = Math.min(6, Math.floor(accumulator * state.fps / 1000)); accumulator -= count * 1000 / state.fps;
    try {
      input!.input.poll(win.document.hidden ? [] : Array.from(win.navigator.getGamepads?.() ?? []));
      state = await client.request<MameFrame>("STEP", {count, events: events.splice(0)});
      if (stopped || paused) {return;} frameCount += count;
      for (const samples of state.audio) {audio!.pushSamples(samples);}
      animation = win.requestAnimationFrame(value => {void tick(value);});
    } catch (error) {
      if (!stopped) {await exit(); content.onFailure?.(error instanceof Error ? error : new Error("MAME_EXECUTION_FAILED"));}
    }
  }
  return {
    touchGamepad: mameTouchGamepad(config.machine, true),
    exit, getCanvas: () => stopped ? null : canvas, getFrameCount: () => frameCount, getDisplayAspectRatio: () => state.aspect,
    getCheckpointAvailability: () => stopped ? {available: false, blocker: "NOT_READY"} : state.checkpointSize > 0 && state.checkpointSize <= checkpointLimit - 108
      ? {available: true, blocker: null} : {available: false, blocker: "UNSUPPORTED"},
    checkpoint: async () => {active(); const snapshot = await client.request<MameWorkerState>("SAVE");
      const bytes = await encodeState(identity, build, encodeWorkerState(snapshot)); active(); return {bytes, format: checkpointFormat};},
    pause: async () => {active(); paused = true; win.cancelAnimationFrame(animation); input!.input.clear();
      await client.request("STEP", {count: 0, events: events.splice(0)}); await audio!.pause();},
    resume: async () => {active(); if (!paused) {return;} paused = false; lastTime = 0; accumulator = 0; unlock();
      animation = win.requestAnimationFrame(time => {void tick(time);});},
    screenshot: async () => {active(); return captureVideo(canvas, state.aspect);},
    setVolume: value => audio!.setVolume(value),
  };
}

function validateFrame(state: MameFrame) {
  if (!Number.isFinite(state.fps) || state.fps < 20 || state.fps > 120 || !Number.isFinite(state.rate) || state.rate < 8000 || state.rate > 96000 ||
    !Number.isFinite(state.aspect) || state.aspect <= 0 || state.aspect > 10) {throw new Error("MAME_AV_INVALID");}
}
