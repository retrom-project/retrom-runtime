import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";
import {loadCore, withBytes, type ModuleLoader, type NXEngineParameters} from "./core.js";
import {nativeSaves} from "./native-saves.js";
import {decodeSave} from "./save.js";
import {keyboardPadMask, padMask} from "./input.js";
import {NXEngineAudio} from "./audio.js";
export async function mountNXEngine(config: NXEngineParameters, target: HTMLElement, frameWindow: Window,
  restorePayload: Uint8Array | null, progress: RuntimeProgressReporter, reportFailure: (error: Error) => void,
  signal?: AbortSignal, loader?: ModuleLoader): Promise<MountedRuntimeAdapter> {
  if (restorePayload) {decodeSave(restorePayload, config.contentDigest);}
  const core = await loadCore(config, progress, signal, loader);
  const saves = nativeSaves(core, config.contentDigest, restorePayload);
  const canvas = frameWindow.document.createElement("canvas");
  canvas.tabIndex = 0; canvas.setAttribute("aria-label", "nxengine game");
  const graphics = canvas.getContext("2d", {alpha: false});
  if (!graphics) {core._retrom_stop(); throw new Error("NXENGINE_CANVAS_UNAVAILABLE");}
  const audio = new NXEngineAudio(22050), keyboardKeys = new Set<string>();
  let stopped = false, paused = false, frames = 0, request = 0, previous = 0, elapsed = 0;
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
    frameWindow.cancelAnimationFrame(request); releaseKeys();
    for (const type of ["keydown", "keyup"]) {frameWindow.removeEventListener(type, keyboard as EventListener);}
    frameWindow.removeEventListener("blur", releaseKeys); frameWindow.removeEventListener("pointerdown", unlock);
    signal?.removeEventListener("abort", abort); core._retrom_stop(); canvas.remove(); await audio.stop();
  };
  const abort = () => {void exit();};
  const tick = (time: number) => {
    if (stopped || paused) {return;}
    elapsed += Math.min(100, previous ? time - previous : 1000 / core._retrom_fps()); previous = time;
    try {
      const interval = 1000 / core._retrom_fps();
      if (!Number.isFinite(interval) || interval < 5 || interval > 100) {throw new Error("NXENGINE_TIMING_INVALID");}
      while (elapsed >= interval) {
        const pads = frameWindow.document.hidden ? [] : Array.from(frameWindow.navigator.getGamepads?.() ?? []).filter((pad) => pad?.connected);
        const first = padMask(pads[0] ?? null) | (frameWindow.document.hidden ? 0 : keyboardPadMask(keyboardKeys));
        const second = padMask(pads[1] ?? null);
        if (core._retrom_step(first, second) !== 1) {throw new Error("NXENGINE_EXECUTION_FAILED");}
        frames++; audio.push(core); elapsed -= interval;
      }
      draw(); request = frameWindow.requestAnimationFrame(tick);
    } catch (error) {void exit(); reportFailure(error instanceof Error ? error : new Error("NXENGINE_EXECUTION_FAILED"));}
  };
  try {
    signal?.throwIfAborted();
    saves.importBeforeStart();
    const path = new TextEncoder().encode("/game/Doukutsu.exe\0");
    if (withBytes(core, path, (pointer) => core._retrom_load(pointer)) !== 1) {throw new Error("NXENGINE_PROJECT_INVALID");}
    draw(); target.append(canvas); canvas.focus();
    for (const type of ["keydown", "keyup"]) {frameWindow.addEventListener(type, keyboard as EventListener);}
    frameWindow.addEventListener("blur", releaseKeys); frameWindow.addEventListener("pointerdown", unlock);
    signal?.addEventListener("abort", abort, {once: true}); unlock(); request = frameWindow.requestAnimationFrame(tick);
  } catch (error) {await exit(); throw error;}
  return {
    exit, getCanvas: () => stopped ? null : canvas, getFrameCount: () => frames,
    getCheckpointAvailability: () => stopped ? {available: false, blocker: "NOT_READY"} : saves.availability(),
    checkpoint: async () => {requireActive(); return saves.capture();},
    acknowledgeCheckpoint: async (checkpoint) => {requireActive(); saves.acknowledge(checkpoint);},
    pause: async () => {requireActive(); paused = true; releaseKeys(); frameWindow.cancelAnimationFrame(request); await audio.pause();},
    resume: async () => {requireActive(); if (!paused) {return;} paused = false; previous = 0; elapsed = 0; unlock(); request = frameWindow.requestAnimationFrame(tick);},
    screenshot: async () => {requireActive(); return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob?.size ? resolve(blob) : reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE")), "image/png"));},
    setVolume: (value) => audio.setVolume(value),
  };
}
