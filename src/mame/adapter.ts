import {withStartupTask} from "../provider/startup.js";
import type {MountedRuntimeAdapter} from "../internal-adapter.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {loadCore, withMemory, type MameParameters, type ModuleLoader} from "./core.js";
import {mountFiles} from "./files.js";
import {installInput} from "./input.js";
import {checkpointFormat, checkpointLimit, decodeState, encodeState} from "./state.js";
import {MameAudio} from "./audio.js";
import {createVideo, captureVideo} from "./video.js";
import {profiles} from "./profiles.js";
export async function mountMame(config: MameParameters, target: HTMLElement, win: Window,
  restorePayload: Uint8Array | null, content: AdapterContentOptions, loader?: ModuleLoader): Promise<MountedRuntimeAdapter> {
  const {core, build} = await loadCore(config, content, loader);
  let identity: string;
  try {
    identity = await withStartupTask(content.startup, "CONTENT_MOUNT", () => mountFiles(core, config, content));
    content.signal?.throwIfAborted();
    await withStartupTask(content.startup, "CORE_INITIALIZATION", async () => {
      if (content.startup) {await new Promise<void>(resolve => win.setTimeout(resolve, 0));}
      content.signal?.throwIfAborted();
      const command = new TextEncoder().encode("/content/boot.cmd\0");
      const loaded = withMemory(core, command.length, pointer => {core.HEAPU8.set(command, pointer); return core._retrom_mame_start(pointer);});
      if (loaded !== 1) {throw new Error("MAME_BOOT_FAILED");}
    });
    if (restorePayload) {
      await withStartupTask(content.startup, "RESTORE_APPLY", async () => {
        const native = await decodeState(identity, build, restorePayload);
        const restored = withMemory(core, native.length, pointer => {core.HEAPU8.set(native, pointer); return core._retrom_mame_restore(pointer, native.length);});
        if (restored !== 1) {throw new Error("MAME_CHECKPOINT_RESTORE_FAILED");}
      });
    }
    content.signal?.throwIfAborted();
    return startLoop();
  } catch (error) {core._retrom_mame_stop(); throw error;}

  function startLoop(): MountedRuntimeAdapter {
    const rate = core._retrom_mame_sample_rate(), fps = core._retrom_mame_fps(), aspect = core._retrom_mame_aspect_ratio();
    if (!Number.isFinite(aspect) || aspect <= 0 || aspect > 10) {throw new Error("MAME_AV_INVALID");}
    if (!Number.isFinite(fps) || fps < 20 || fps > 120 || !Number.isFinite(rate) || rate < 8000 || rate > 96000) {throw new Error("MAME_AV_INVALID");}
    const label = config.arcade === true ? `MAME Arcade (${config.machine})` : profiles[config.machine].label;
    const {canvas, draw} = createVideo(win, core, label), keyboard = installInput(win, core, config.machine, config.arcade === true), audio = new MameAudio(rate);
    let stopped = false, paused = false, request = 0, previous = 0, accumulator = 0, frames = 1;
    const active = () => {if (stopped) {throw new Error("MAME_RUNTIME_STOPPED");}};
    const unlock = () => {if (!stopped && !paused) {void audio.resume().catch(() => undefined);}};
    const exit = async () => {
      if (stopped) {return;}
      stopped = true; win.cancelAnimationFrame(request); keyboard.stop();
      content.signal?.removeEventListener("abort", abort); win.removeEventListener("pointerdown", unlock); win.removeEventListener("keydown", unlock);
      core._retrom_mame_stop(); canvas.remove(); await audio.stop();
    };
    const abort = () => {void exit();};
    const tick = (time: number) => {
      if (stopped || paused) {return;}
      accumulator += Math.min(100, previous ? time - previous : 1000 / fps); previous = time;
      try {
        while (accumulator >= 1000 / fps) {
          keyboard.input.poll(win.document.hidden ? [] : Array.from(win.navigator.getGamepads?.() ?? []));
          if (core._retrom_mame_step() !== 1) {throw new Error("MAME_EXECUTION_STOPPED");}
          frames++; audio.push(core); accumulator -= 1000 / fps;
        }
        draw(); request = win.requestAnimationFrame(tick);
      } catch (error) {void exit(); content.onFailure?.(error instanceof Error ? error : new Error("MAME_EXECUTION_FAILED"));}
    };
    draw(); target.append(canvas); canvas.focus();
    content.signal?.addEventListener("abort", abort, {once: true}); win.addEventListener("pointerdown", unlock); win.addEventListener("keydown", unlock);
    unlock(); request = win.requestAnimationFrame(tick);
    return {
      exit, getCanvas: () => stopped ? null : canvas, getFrameCount: () => frames,
      getDisplayAspectRatio: () => core._retrom_mame_aspect_ratio(),
      getCheckpointAvailability: () => stopped ? {available: false, blocker: "NOT_READY"} :
        core._retrom_mame_save_size() > 0 ? {available: true, blocker: null} : {available: false, blocker: "UNSUPPORTED"},
      checkpoint: async () => {
        active(); const size = core._retrom_mame_save_size();
        if (size < 1 || size > checkpointLimit - 108) {throw new Error("MAME_CHECKPOINT_UNAVAILABLE");}
        const native = withMemory(core, size, pointer => {
          if (core._retrom_mame_save(pointer, size) !== 1) {throw new Error("MAME_CHECKPOINT_UNAVAILABLE");}
          return core.HEAPU8.slice(pointer, pointer + size);
        });
        const bytes = await encodeState(identity, build, native); active(); return {bytes, format: checkpointFormat};
      },
      pause: async () => {active(); paused = true; win.cancelAnimationFrame(request); keyboard.input.clear(); await audio.pause();},
      resume: async () => {active(); if (!paused) {return;} paused = false; accumulator = 0; previous = 0; unlock(); request = win.requestAnimationFrame(tick);},
      screenshot: async () => {
        active(); return captureVideo(canvas, core._retrom_mame_aspect_ratio());
      },
      setVolume: value => audio.setVolume(value),
    };
  }
}
