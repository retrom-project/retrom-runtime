import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";
import {loadCore, type CoreLoader, type CoreParameters, type NP2Core} from "./core.js";
import {loadDisk, openDiskStore, type DiskSource} from "./content.js";
import {configuration, diskName} from "./disk.js";
import {installGamepad} from "./input.js";
import {decodeState, encodeState} from "./state.js";
export type NP2Parameters = CoreParameters & {disk: DiskSource};
const root = "/emulator/np2kai/";
export async function mountNP2(config: NP2Parameters, target: HTMLElement, win: Window,
  restore: Uint8Array | null, progress: RuntimeProgressReporter, reportFailure: (error: Error) => void,
  signal?: AbortSignal, loader: CoreLoader = loadCore): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== win.document) {throw new Error("NP2KAI_RUNTIME_CONFIG_INVALID");}
  const base = await loadDisk(config.disk, progress, await openDiskStore(win), signal);
  const name = diskName(base), restored = restore ? decodeState(restore, config.disk.sha256, base) : null;
  const canvas = win.document.createElement("canvas"); canvas.width = 640; canvas.height = 400; canvas.tabIndex = 0; canvas.id = "canvas";
  canvas.setAttribute("aria-label", "PC-98 game"); target.append(canvas);
  let core: NP2Core;
  try {core = await loader(config, win, canvas, signal);} catch (error) {canvas.remove(); throw error;}
  let stopped = false, paused = true;
  const controls = installGamepad(win, (key, value) => core._retrom_key(key, value));
  const exit = async () => {
    if (stopped) {return;}
    stopped = true; controls.stop(); signal?.removeEventListener("abort", abort);
    core._retrom_stop(); canvas.remove();
  };
  const abort = () => {void exit();};
  try {
    signal?.throwIfAborted();
    core.FS.writeFile(root + name, restored?.disk ?? base);
    core.FS.writeFile(root + "np21kai.cfg", configuration(name));
    const main = core.callMain(["-c", root + "np21kai.cfg", ...(name.endsWith(".d88") ? [root + name] : [])]);
    void Promise.resolve(main).catch(error => {if (!stopped) {void exit(); reportFailure(asError(error));}});
    await waitReady(core, win, signal);
    if (restored) {
      core.FS.writeFile(root + "state.bin", restored.state);
      if (core._retrom_restore() !== 0) {throw new Error("NP2KAI_CHECKPOINT_RESTORE_FAILED");}
      core.FS.unlink(root + "state.bin");
    }
    signal?.throwIfAborted(); signal?.addEventListener("abort", abort, {once: true});
    paused = false; core._retrom_pause(0); canvas.focus();
  } catch (error) {await exit(); throw error;}
  const active = () => {if (stopped) {throw new Error("NP2KAI_RUNTIME_EXITED");}};
  return {
    async checkpoint() {
      active(); const wasPaused = paused; core._retrom_pause(1); controls.pause(true);
      try {
        if (core._retrom_save() !== 0) {throw new Error("NP2KAI_CHECKPOINT_FAILED");}
        const state = core.FS.readFile(root + "state.bin"), disk = core.FS.readFile(root + name);
        const bytes = encodeState(config.disk.sha256, base, disk, state);
        core.FS.unlink(root + "state.bin"); return {bytes, format: "np2kai-state-v1"};
      } finally {if (!stopped) {core._retrom_pause(wasPaused ? 1 : 0); controls.pause(wasPaused);}}
    },
    exit,
    getCanvas: () => stopped ? null : canvas,
    getFrameCount: () => stopped ? null : core._retrom_frame_count(),
    getCheckpointAvailability: () => stopped ? {available: false, blocker: "NOT_READY"} : {available: true, blocker: null},
    async pause() {active(); paused = true; controls.pause(true); core._retrom_pause(1);},
    async resume() {active(); paused = false; controls.pause(false); core._retrom_pause(0);},
    async screenshot() {
      active();
      const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("NP2KAI_SCREENSHOT_FAILED")), "image/png"));
      return new Blob([await image.arrayBuffer()], {type: image.type});
    },
    setVolume: null,
  };
}
async function waitReady(core: NP2Core, win: Window, signal?: AbortSignal) {
  const deadline = performance.now() + 30000;
  while (!core._retrom_is_ready()) {
    signal?.throwIfAborted();
    if (performance.now() >= deadline) {throw new Error("NP2KAI_START_TIMEOUT");}
    await new Promise(resolve => win.setTimeout(resolve, 10));
  }
}
function asError(value: unknown) {return value instanceof Error ? value : new Error("NP2KAI_RUNTIME_FAILED");}
