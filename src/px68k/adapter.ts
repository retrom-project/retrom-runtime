import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";
import {loadCore, withBytes, type ModuleLoader, type Px68kParameters} from "./core.js";
import {checkpointFormat, decodeCheckpoint, encodeCheckpoint} from "./state.js";
import {keyCode, keyboardPadMask, padMask} from "./input.js";
import {Px68kAudio} from "./audio.js";
export async function mountPx68k(config: Px68kParameters, target: HTMLElement, frameWindow: Window,
  restorePayload: Uint8Array | null, progress: RuntimeProgressReporter, reportFailure: (error: Error) => void,
  signal?: AbortSignal, loader?: ModuleLoader): Promise<MountedRuntimeAdapter> {
  const restored = restorePayload ? decodeCheckpoint(config.game.sha256, restorePayload) : null;
  const {core, disk} = await loadCore(config, progress, signal, loader);
  const canvas = frameWindow.document.createElement("canvas");
  canvas.tabIndex = 0; canvas.setAttribute("aria-label", "px68k game");
  const graphics = canvas.getContext("2d", {alpha: false});
  if (!graphics) {core._retrom_stop(); throw new Error("PX68K_CANVAS_UNAVAILABLE");}
  const audio = new Px68kAudio(44100), keyboardKeys = new Set<string>();
  let stopped = false, paused = false, frames = restored?.frames ?? 0, request = 0, previous = 0, elapsed = 0;
  const requireActive = () => {if (stopped) {throw new Error("PX68K_RUNTIME_STOPPED");}};
  const draw = () => {
    const width = core._retrom_width(), height = core._retrom_height(), pointer = core._retrom_pixels();
    if (width < 1 || width > 800 || height < 1 || height > 600 || pointer < 1 || pointer + width * height * 4 > core.HEAPU8.length) {
      throw new Error("PX68K_FRAME_INVALID");
    }
    if (canvas.width !== width) {canvas.width = width;} if (canvas.height !== height) {canvas.height = height;}
    const image = graphics.createImageData(width, height);
    image.data.set(core.HEAPU8.subarray(pointer, pointer + width * height * 4)); graphics.putImageData(image, 0, 0);
  };
  const releaseKeys = () => {for (let key = 0; key < 512; key++) {core._retrom_key(key, 0);} keyboardKeys.clear();};
  const keyboard = (event: KeyboardEvent) => {
    if (paused || stopped) {return;}
    const key = keyCode(event); if (key === null) {return;}
    if (event.type === "keydown") {keyboardKeys.add(event.code);} else {keyboardKeys.delete(event.code);}
    core._retrom_key(key, Number(event.type === "keydown")); event.preventDefault();
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
      if (!Number.isFinite(interval) || interval < 5 || interval > 100) {throw new Error("PX68K_TIMING_INVALID");}
      while (elapsed >= interval) {
        const pads = frameWindow.document.hidden ? [] : Array.from(frameWindow.navigator.getGamepads?.() ?? []).filter((pad) => pad?.connected);
        const first = padMask(pads[0] ?? null) | (frameWindow.document.hidden ? 0 : keyboardPadMask(keyboardKeys));
        const second = padMask(pads[1] ?? null);
        if (core._retrom_step(first, second) !== 1) {throw new Error("PX68K_EXECUTION_FAILED");}
        frames++; audio.push(core); elapsed -= interval;
      }
      draw(); request = frameWindow.requestAnimationFrame(tick);
    } catch (error) {void exit(); reportFailure(error instanceof Error ? error : new Error("PX68K_EXECUTION_FAILED"));}
  };
  try {
    signal?.throwIfAborted();
    if (restored) {
      for (const [name, bytes] of Object.entries(restored.files)) {
        if (name !== disk && name !== "sram.dat") {throw new Error("PX68K_CHECKPOINT_INVALID");}
        core.FS.writeFile(name === "sram.dat" ? "/game/keropi/sram.dat" : `/game/${name}`, bytes);
      }
    }
    const path = new TextEncoder().encode(`/game/${disk}\0`);
    if (withBytes(core, path, (pointer) => core._retrom_load(pointer)) !== 1) {throw new Error("PX68K_DISK_INVALID");}
    if (restored && withBytes(core, restored.state, (pointer) => core._retrom_restore(pointer, restored.state.length)) !== 1) {
      throw new Error("PX68K_RESTORE_FAILED");
    }
    draw(); target.append(canvas); canvas.focus();
    for (const type of ["keydown", "keyup"]) {frameWindow.addEventListener(type, keyboard as EventListener);}
    frameWindow.addEventListener("blur", releaseKeys); frameWindow.addEventListener("pointerdown", unlock);
    signal?.addEventListener("abort", abort, {once: true}); unlock(); request = frameWindow.requestAnimationFrame(tick);
  } catch (error) {await exit(); throw error;}
  return {
    exit, getCanvas: () => stopped ? null : canvas, getFrameCount: () => frames,
    getCheckpointAvailability: () => !stopped && core._retrom_ready() === 1 ? {available: true, blocker: null} : {available: false, blocker: "NOT_READY"},
    checkpoint: async () => {
      requireActive();
      const pointer = core._retrom_state(), size = core._retrom_state_size();
      if (!pointer || size < 1 || size > 32 * 1024 * 1024 || pointer + size > core.HEAPU8.length) {throw new Error("PX68K_CHECKPOINT_UNAVAILABLE");}
      const files: Record<string, Uint8Array> = {[disk]: core.FS.readFile(`/game/${disk}`)};
      return {format: checkpointFormat, bytes: encodeCheckpoint(config.game.sha256, core.HEAPU8.slice(pointer, pointer + size), files, frames)};
    },
    pause: async () => {requireActive(); paused = true; releaseKeys(); frameWindow.cancelAnimationFrame(request); await audio.pause();},
    resume: async () => {requireActive(); if (!paused) {return;} paused = false; previous = 0; elapsed = 0; unlock(); request = frameWindow.requestAnimationFrame(tick);},
    screenshot: async () => {requireActive(); return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob?.size ? resolve(blob) : reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE")), "image/png"));},
    setVolume: (value) => audio.setVolume(value),
  };
}
