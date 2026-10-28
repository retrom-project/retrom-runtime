import {canvasRuntimeEvents} from "../provider/canvas-runtime-events.js";
import {nativeFrameLoop} from "../provider/native-frame-loop.js";
import {canvasScreenshot} from "../provider/canvas-screenshot.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";
import {loadCore, withBytes, type ModuleLoader, type NXEngineParameters} from "./core.js";
import {nativeSaves} from "./native-saves.js";
import {decodeSave} from "./save.js";
import {keyboardPadMask, padMask} from "./input.js";
import {NXEngineAudio} from "./audio.js";
import {touchGamepadProfiles} from "../provider/touch-gamepad-layout.js";
export async function mountNXEngine(config: NXEngineParameters, target: HTMLElement, frameWindow: Window,
  restorePayload: Uint8Array | null, progress: RuntimeProgressReporter, reportFailure: (error: Error) => void,
  signal?: AbortSignal, loader?: ModuleLoader, content?: AdapterContentOptions): Promise<MountedRuntimeAdapter> {
  if (restorePayload) {decodeSave(restorePayload, config.contentDigest);}
  const core = await loadCore(config, progress, signal, loader, content?.contentSession);
  const saves = nativeSaves(core, config.contentDigest, restorePayload);
  const canvas = frameWindow.document.createElement("canvas");
  canvas.tabIndex = 0; canvas.setAttribute("aria-label", "nxengine game");
  const graphics = canvas.getContext("2d", {alpha: false});
  if (!graphics) {core._retrom_stop(); throw new Error("NXENGINE_CANVAS_UNAVAILABLE");}
  const audio = new NXEngineAudio(22050), keyboardKeys = new Set<string>();
  let stopped = false, paused = false, frames = 0;
  const requireActive = () => {if (stopped) {throw new Error("NXENGINE_RUNTIME_STOPPED");}};
  const draw = () => {
    const width = core._retrom_width(), height = core._retrom_height(), pointer = core._retrom_pixels();
    if (width < 1 || width > 320 || height < 1 || height > 240 || pointer < 1 || pointer + width * height * 4 > core.HEAPU8.length) {
      throw new Error("NXENGINE_FRAME_INVALID");
    }
    if (canvas.width !== width) {canvas.width = width;} if (canvas.height !== height) {canvas.height = height;}
    const image = graphics.createImageData(width, height);
    image.data.set(core.HEAPU8.subarray(pointer, pointer + width * height * 4)); graphics.putImageData(image, 0, 0);
  };
  const releaseKeys = () => { keyboardKeys.clear();};
  const keyboard = (event: KeyboardEvent) => {
    if (paused || stopped) {return;}
    if (!keyboardPadMask(new Set([event.code]))) {return;}
    if (event.type === "keydown") {keyboardKeys.add(event.code);} else {keyboardKeys.delete(event.code);}
    event.preventDefault();
  };
  const unlock = () => {if (!paused && !stopped) {void audio.resume().catch(() => undefined);}};
  const exit = async () => {
    if (stopped) {return;} stopped = true;
    loop.stop(); releaseKeys(); events.dispose(); core._retrom_stop(); canvas.remove(); await audio.stop();
  };
  const events = canvasRuntimeEvents(frameWindow, {keyboard, releaseKeys, unlock, exit, signal});
  const loop = nativeFrameLoop(frameWindow, {
    timingError: "NXENGINE_TIMING_INVALID", active: () => !stopped && !paused,
    framesPerSecond: () => core._retrom_fps(), draw,
    step: () => {
      const pads = frameWindow.document.hidden ? [] : Array.from(frameWindow.navigator.getGamepads?.() ?? []).filter((pad) => pad?.connected);
      const first = padMask(pads[0] ?? null) | (frameWindow.document.hidden ? 0 : keyboardPadMask(keyboardKeys));
      const second = padMask(pads[1] ?? null);
      if (core._retrom_step(first, second) !== 1) {throw new Error("NXENGINE_EXECUTION_FAILED");}
      frames++; audio.push(core);
    },
    onFailure: (error) => {void exit(); reportFailure(error instanceof Error ? error : new Error("NXENGINE_EXECUTION_FAILED"));},
  });
  try {
    signal?.throwIfAborted();
    saves.importBeforeStart();
    const path = new TextEncoder().encode("/game/Doukutsu.exe\0");
    if (withBytes(core, path, (pointer) => core._retrom_load(pointer)) !== 1) {throw new Error("NXENGINE_PROJECT_INVALID");}
    draw(); target.append(canvas); canvas.focus();
    events.listen(); unlock(); loop.start();
  } catch (error) {await exit(); throw error;}
  return {
    touchGamepad: touchGamepadProfiles.action,
    exit, getCanvas: () => stopped ? null : canvas, getFrameCount: () => frames,
    getCheckpointAvailability: () => stopped ? {available: false, blocker: "NOT_READY"} : saves.availability(),
    checkpoint: async () => {requireActive(); return saves.capture();},
    acknowledgeCheckpoint: async (checkpoint) => {requireActive(); saves.acknowledge(checkpoint);},
    pause: async () => {requireActive(); paused = true; releaseKeys(); loop.stop(); await audio.pause();},
    resume: async () => {requireActive(); if (!paused) {return;} paused = false; unlock(); loop.resume();},
    screenshot: () => canvasScreenshot(canvas, requireActive),
    setVolume: (value) => audio.setVolume(value),
  };
}
