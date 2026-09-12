import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";
import {loadCore, type CoreLoader, type GBEParameters} from "./core.js";
import {fetchFile} from "./files.js";
import {installInput} from "./input.js";
import {decodeState, encodeState, stateFormat} from "./state.js";
const statePath = "/game.min.ss";
export async function mountGBE(config: GBEParameters, target: HTMLElement, win: Window,
  restore: Uint8Array | null, progress: RuntimeProgressReporter, signal?: AbortSignal,
  loader: CoreLoader = loadCore): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== win.document) {throw new Error("GBE_CONFIG_INVALID");}
  const bios = config.bios.filter(file => file.logicalName === "bios.min");
  if (bios.length !== 1 || bios[0].sizeBytes !== 4096) {throw new Error("GBE_BIOS_MISSING");}
  if (config.game.sizeBytes < 0x2100 || config.game.sizeBytes > 0x200000) {throw new Error("GBE_ROM_INVALID");}
  const restored = restore ? decodeState(config.game.sha256, restore) : null;
  const game = await fetchFile(config.game, loadedBytes => progress({phase: "PROJECT_CONTENT", loadedBytes,
    totalBytes: config.game.sizeBytes}), signal);
  const firmware = await fetchFile(bios[0], () => undefined, signal);
  const canvas = win.document.createElement("canvas"); canvas.width = 96; canvas.height = 64; canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Pokémon Mini game"); target.append(canvas);
  const core = await loader(config, win, canvas, signal).catch(error => {canvas.remove(); throw error;});
  const input = installInput(win, (key, value) => core._retrom_key(key, value));
  let stopped = false, paused = true;
  const exit = async () => {
    if (stopped) {return;}
    stopped = true; input.stop(); signal?.removeEventListener("abort", abort); core._retrom_stop(); canvas.remove();
  };
  const abort = () => {void exit();};
  try {
    signal?.throwIfAborted(); core.FS.writeFile("/game.min", game); core.FS.writeFile("/bios.min", firmware);
    if (core._retrom_init() !== 0 || !core._retrom_is_ready()) {throw new Error("GBE_START_FAILED");}
    if (restored) {
      core.FS.writeFile(statePath, restored);
      if (core._retrom_restore() !== 0) {throw new Error("GBE_RESTORE_FAILED");}
      core.FS.unlink(statePath);
    }
    signal?.throwIfAborted(); signal?.addEventListener("abort", abort, {once: true});
    paused = false; core._retrom_pause(0); canvas.focus();
  } catch (error) {await exit(); throw error;}
  const active = () => {if (stopped) {throw new Error("GBE_RUNTIME_EXITED");}};
  return {
    async checkpoint() {
      active(); const wasPaused = paused; input.pause(true); core._retrom_pause(1);
      try {
        if (core._retrom_save() !== 0) {throw new Error("GBE_CHECKPOINT_FAILED");}
        const bytes = encodeState(config.game.sha256, core.FS.readFile(statePath)); core.FS.unlink(statePath);
        return {bytes, format: stateFormat};
      } finally {if (!stopped) {core._retrom_pause(wasPaused ? 1 : 0); input.pause(wasPaused);}}
    },
    exit, getCanvas: () => stopped ? null : canvas,
    getFrameCount: () => stopped ? null : core._retrom_frame_count(),
    getCheckpointAvailability: () => stopped ? {available: false, blocker: "NOT_READY"} : {available: true, blocker: null},
    async pause() {active(); paused = true; input.pause(true); core._retrom_pause(1);},
    async resume() {active(); paused = false; core._retrom_pause(0); input.pause(false);},
    async screenshot() {
      active(); const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
        blob ? resolve(blob) : reject(new Error("GBE_SCREENSHOT_FAILED")), "image/png"));
      return new Blob([await image.arrayBuffer()], {type: image.type});
    },
    setVolume: async value => {active(); core._retrom_volume(Math.round(Math.max(0, Math.min(1, value)) * 128));},
  };
}
