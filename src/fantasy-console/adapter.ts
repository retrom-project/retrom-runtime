import {PersistentMemory} from "./pmem.js";
import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";
import {checkpointFormats, checkpointLimits, decodeState, encodeState} from "./state.js";
import {controlMask, installKeyboard} from "./input.js";
import {loadCore, withBytes, type FantasyParameters, type ModuleLoader} from "./core.js";
import {FantasyAudio} from "./audio.js";

export async function mountFantasyConsole(config: FantasyParameters, target: HTMLElement,
  frameWindow: Window, restorePayload: Uint8Array | null, progress: RuntimeProgressReporter,
  reportFailure: (error: Error) => void, signal?: AbortSignal,
  loader: ModuleLoader = (url) => import(/* webpackIgnore: true */ /* @vite-ignore */ url),
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document) {throw new Error("FANTASY_RUNTIME_CONFIG_INVALID");}
  const restore = restorePayload ? await decodeState(config.core, config.contentDigest, restorePayload) : null;
  signal?.throwIfAborted();
  const {core, cart} = await loadCore(config, progress, signal, loader);
  const pmem = config.core === "tic80" ? new PersistentMemory(core, restore) : null;
  const canvas = frameWindow.document.createElement("canvas");
  canvas.width = config.core === "tic80" ? 240 : 128;
  canvas.height = config.core === "tic80" ? 136 : 128;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", `${config.core} game`);
  const graphics = canvas.getContext("2d", {alpha: false, willReadFrequently: true});
  if (!graphics) {core._retrom_stop(); throw new Error("FANTASY_CANVAS_UNAVAILABLE");}
  const keys = installKeyboard(frameWindow);
  const audio = new FantasyAudio(config.core === "tic80" ? 44100 : 22050);
  let stopped = false, paused = false, frames = 0, request = 0, previous = 0, accumulator = 0;
  const draw = () => {
    const pointer = core._retrom_pixels(), size = canvas.width * canvas.height * 4;
    if (pointer < 1 || pointer + size > core.HEAPU8.length) {throw new Error("FANTASY_FRAME_INVALID");}
    const bitmap = graphics.createImageData(canvas.width, canvas.height);
    bitmap.data.set(core.HEAPU8.subarray(pointer, pointer + size)); graphics.putImageData(bitmap, 0, 0);
  };
  const exit = async () => {
    if (stopped) {return;}
    stopped = true; frameWindow.cancelAnimationFrame(request); keys.stop();
    signal?.removeEventListener("abort", abort);
    frameWindow.removeEventListener("pointerdown", unlock);
    frameWindow.removeEventListener("keydown", unlock);
    core._retrom_stop(); canvas.remove(); await audio.stop();
  };
  const abort = () => {void exit();};
  const unlock = () => {if (!stopped && !paused) {void audio.resume().catch(() => undefined);}};
  const tick = (time: number) => {
    if (stopped || paused) {return;}
    accumulator += Math.min(100, previous ? time - previous : 1000 / 60); previous = time;
    try {
      while (accumulator >= 1000 / 60) {
        const mask = frameWindow.document.hidden ? 0 : controlMask(config.core, keys.keys,
          Array.from(frameWindow.navigator.getGamepads?.() ?? []));
        if (core._retrom_step(mask) !== 1) {throw new Error("FANTASY_CORE_EXECUTION_FAILED");}
        audio.push(core); frames++; accumulator -= 1000 / 60;
      }
      draw(); request = frameWindow.requestAnimationFrame(tick);
    } catch (error) {
      void exit(); reportFailure(error instanceof Error ? error : new Error("FANTASY_CORE_EXECUTION_FAILED"));
    }
  };
  const requireActive = () => {if (stopped) {throw new Error("FANTASY_RUNTIME_STOPPED");}};
  try {
    signal?.throwIfAborted();
    if (withBytes(core, cart, (pointer) => core._retrom_load(pointer, cart.length)) !== 1) {
      throw new Error("FANTASY_CART_INVALID");
    }
    if (restore && withBytes(core, restore, (pointer) => core._retrom_restore(pointer, restore.length)) !== 1) {
      throw new Error("FANTASY_CHECKPOINT_RESTORE_FAILED");
    }
    if (core._retrom_step(0) !== 1) {throw new Error("FANTASY_CORE_EXECUTION_FAILED");}
    frames++; draw(); target.append(canvas); canvas.focus();
    signal?.addEventListener("abort", abort, {once: true});
    frameWindow.addEventListener("pointerdown", unlock);
    frameWindow.addEventListener("keydown", unlock);
    unlock(); request = frameWindow.requestAnimationFrame(tick);
  } catch (error) {await exit(); throw error;}
  return {
    checkpoint: async () => {
      requireActive();
      const pointer = core._retrom_state(), size = core._retrom_state_size();
      if (!pointer || size < 1 || size > checkpointLimits[config.core] - 76 || pointer + size > core.HEAPU8.length) {
        throw new Error("FANTASY_CHECKPOINT_UNAVAILABLE");
      }
      const bytes = await encodeState(config.core, config.contentDigest, core.HEAPU8.slice(pointer, pointer + size));
      requireActive(); return {bytes, format: checkpointFormats[config.core]};
    },
    acknowledgeCheckpoint: async (checkpoint) => {
      requireActive();
      if (pmem) {pmem.acknowledge(await decodeState(config.core, config.contentDigest, checkpoint.bytes));}
    },
    exit,
    getCanvas: () => stopped ? null : canvas,
    getFrameCount: () => frames,
    getCheckpointAvailability: () => stopped || core._retrom_ready() !== 1 ? {available: false, blocker: "NOT_READY"} : pmem?.availability() ?? {available: true, blocker: null},
    pause: async () => {
      requireActive(); paused = true; keys.clear(); frameWindow.cancelAnimationFrame(request); await audio.pause();
    },
    resume: async () => {
      requireActive(); if (!paused) {return;}
      paused = false; previous = 0; accumulator = 0; unlock(); request = frameWindow.requestAnimationFrame(tick);
    },
    screenshot: async () => {
      requireActive();
      return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob?.size
        ? resolve(blob) : reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE")), "image/png"));
    },
    setVolume: (value) => audio.setVolume(value),
  };
}
