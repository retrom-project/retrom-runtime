import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";
import {fetchSwf, type SwfSource} from "./fetch.js";
import {boundedLoad, loadRuffle, waitReady, type RuffleLoader} from "./player.js";
import {RuffleStorage} from "./storage.js";
import {installRuffleGamepad} from "./input.js";

export type RuffleParameters = SwfSource & {runtimeBaseUrl: string};

export async function mountRuffle(config: RuffleParameters, target: HTMLElement, frameWindow: Window,
  restore: Uint8Array | null, progress: RuntimeProgressReporter, signal?: AbortSignal,
  loader: RuffleLoader = loadRuffle): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document) {throw new Error("RUFFLE_RUNTIME_CONFIG_INVALID");}
  const storage = new RuffleStorage(config.contentDigest, restore);
  const realm = frameWindow as Window & {Uint8Array: typeof Uint8Array};
  let cache: CacheStorage | undefined;
  try {cache = frameWindow.caches;} catch { /* A sandbox may disable persistent caching. */ }
  const data = await fetchSwf(config, progress, cache, signal);
  signal?.throwIfAborted();
  const base = new URL(config.runtimeBaseUrl, window.location.href).href;
  const player = await loader(base, frameWindow, signal);
  const api = player.ruffle();
  let exited = false;
  let input: ReturnType<typeof installRuffleGamepad> | undefined;
  const exit = async () => {
    if (exited) {return;}
    exited = true;
    input?.dispose();
    try {api.destroy();} finally {player.remove();}
  };
  try {
    signal?.throwIfAborted();
    if (api.hostAbi !== "ruffle-host-v1" || typeof api.getCanvas !== "function" ||
      typeof api.captureFrame !== "function" || typeof api.destroy !== "function") {throw new Error("RUFFLE_CORE_ABI_MISMATCH");}
    player.style.cssText = "display:block;width:100%;height:100%;position:relative";
    target.replaceChildren(player);
    const hostStorage = Object.freeze({
      get: (name: string) => {const value = storage.get(name); return value ? new realm.Uint8Array(value) : null;},
      put: (name: string, bytes: Uint8Array) => !exited && storage.put(name, bytes),
      remove: (name: string) => {if (!exited) {storage.remove(name);}},
    });
    const loading = api.load({data: new realm.Uint8Array(data), hostStorage,
      swfFileName: "game.swf", hostMovieUrl: `https://retrom.invalid/${config.contentDigest}/game.swf`,
      allowScriptAccess: false, allowNetworking: "none", openUrlMode: "deny",
      compatibilityRules: false, autoplay: "on", unmuteOverlay: "visible", splashScreen: false,
      contextMenu: "off", showSwfDownload: false, letterbox: "on", scale: "showAll",
      forceScale: true, salign: "", forceAlign: true,
      gamepadButtonMapping: {}});
    void loading.then(() => {if (exited) {api.destroy();}}, () => undefined);
    await boundedLoad(loading, signal);
    await waitReady(api, signal);
    const canvas = api.getCanvas();
    if (!canvas) {throw new Error("RUFFLE_SURFACE_UNAVAILABLE");}
    canvas.tabIndex = 0; canvas.focus();
    input = installRuffleGamepad(frameWindow, canvas);
  } catch (error) {await exit(); throw error;}

  const active = () => {if (exited) {throw new Error("RUFFLE_RUNTIME_STOPPED");}};
  return {
    canvasLayout: "CORE",
    checkpoint: async () => {active(); return storage.checkpoint();},
    acknowledgeCheckpoint: async (checkpoint) => {active(); await storage.acknowledge(checkpoint);},
    getCheckpointAvailability: () => exited ? {available: false, blocker: "NOT_READY"} : storage.availability(),
    getCanvas: () => exited ? null : api.getCanvas(), getFrameCount: () => null,
    pause: async () => {active(); input?.pause(); api.suspend();},
    resume: async () => {active(); api.resume(); input?.resume();},
    setVolume: (volume) => {active(); api.volume = volume;}, exit,
    screenshot: async () => {
      active();
      const blob = await api.captureFrame();
      if (!blob.size || blob.type !== "image/png") {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
      // The core runs in the child realm; the Host contract expects its own Blob.
      return new Blob([await blob.arrayBuffer()], {type: blob.type});
    },
  };
}
