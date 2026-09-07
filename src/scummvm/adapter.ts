import {scummvmJson} from "./json.js";
import type {MountedRuntimeAdapter, RuntimeExitReporter, RuntimeProgressReporter} from "../internal-adapter.js";
import {coreAssets} from "./assets.js";
import {ScummvmBridge, type NativeStatus} from "./bridge.js";
import {decodeScummvmSave, saveDigest} from "./checkpoint.js";
import {openScummvmBlockCache, ScummvmFiles} from "./files.js";
import {loadScummvmModule, validFactory, type ScummvmModuleLoader} from "./module.js";
import {selectionConfig, type ScummvmParameters} from "./parameters.js";

export async function mountScummvm(config: ScummvmParameters, target: HTMLElement, frameWindow: Window,
  restorePayload: Uint8Array | null, reportProgress: RuntimeProgressReporter, reportExit: RuntimeExitReporter,
  reportFailure: (error: Error) => void, signal?: AbortSignal, loader: ScummvmModuleLoader = loadScummvmModule,
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document) {throw new Error("SCUMMVM_RUNTIME_CONFIG_INVALID");}
  const baseConfig = selectionConfig(config.selection, null);
  const base = new URL(config.runtimeBaseUrl, window.location.href).href;
  const identity = await saveDigest(new TextEncoder().encode(`${config.contentDigest}\n${baseConfig}`));
  const restore = restorePayload ? await decodeScummvmSave(restorePayload, identity) : null;
  const restoreSlot = restore?.resumeSlot ?? null;
  const abort = new AbortController();
  const onAbort = () => abort.abort(); signal?.addEventListener("abort", onAbort, {once: true});
  if (signal?.aborted) {onAbort();}
  const bridge = new ScummvmBridge(identity);
  const canvas = frameWindow.document.createElement("canvas");
  canvas.id = "canvas";
  canvas.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;background:black";
  canvas.tabIndex = 0;
  target.replaceChildren(canvas);
  let requestedExit = false;
  let ending = false;
  let ended = false;
  let finalImage: Promise<Blob | null> | null = null;
  let disposed = false;
  let failureReported = false;
  let nativePaused = false;
  let statusSeen = false;
  let restoreConfirmed = restoreSlot === null;
  let pauseWaiter: {value: boolean; resolve(): void} | null = null;
  const ready = deferred(); const stopped = deferred();
  const screenshot = () => new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob?.size ? resolve(blob) : reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE")), "image/png");
  });
  const failed = (cause: unknown) => {
    if (requestedExit || disposed || failureReported) {return;}
    failureReported = true;
    const error = cause instanceof Error && /^SCUMMVM_[A-Z0-9_]+$/u.test(cause.message) ? cause : new Error("SCUMMVM_RUNTIME_FAILED");
    void bridge.stop().catch(() => undefined);
    ready.reject(error); reportFailure(error);
  };
  const coreError = (event: ErrorEvent) => {if (event.filename.startsWith(base)) {failed(event.error);}};
  frameWindow.addEventListener("error", coreError);
  const engineStopping = () => {
    if (ending) {return;}
    ending = true; bridge.beginStop(); ready.reject(new Error("SCUMMVM_RUNTIME_STOPPED"));
    if (!requestedExit) {finalImage = screenshot().catch(() => null);}
  };
  const engineStopped = (error: number) => {
    if (ended) {return;}
    engineStopping();
    ended = true; stopped.resolve();
    const final = bridge.stop();
    if (requestedExit) {void final.catch(() => undefined); return;}
    if (error) {failed(new Error("SCUMMVM_ENGINE_FAILED"));}
    void Promise.all([final, finalImage]).then(([checkpoint, image]) => {
      reportExit(checkpoint ? {checkpoint, screenshot: image} : undefined);
    }).catch(() => {reportFailure(new Error("SCUMMVM_FINAL_SAVE_FAILED")); reportExit();});
  };
  const host = Object.assign(bridge, {
    failure: failed,
    onStatus: (status: NativeStatus) => {
      ScummvmBridge.prototype.onStatus.call(bridge, status); statusSeen = true;
      if (!restoreConfirmed && !status.automatic) {failed(new Error("SCUMMVM_RESTORE_UNSUPPORTED"));}
      else if (restoreConfirmed) {ready.resolve();}
    },
    onRestoreResult: (slot: number, success: boolean) => {
      if (restoreConfirmed) {return;}
      if (!success || slot !== restoreSlot) {failed(new Error("SCUMMVM_RESTORE_FAILED")); return;}
      restoreConfirmed = true;
      if (statusSeen) {ready.resolve();}
    },
    onPaused: (value: boolean) => {
      nativePaused = value;
      if (pauseWaiter?.value === value) {pauseWaiter.resolve(); pauseWaiter = null;}
    },
    onEngineStopping: engineStopping,
    onEngineStopped: engineStopped,
  });
  const dispose = () => {
    if (disposed) {return;}
    disposed = true; abort.abort(); signal?.removeEventListener("abort", onAbort);
    frameWindow.removeEventListener("error", coreError); canvas.remove();
  };
  try {
    const cache = await openScummvmBlockCache(frameWindow);
    const index = await scummvmJson(config.projectIndexUrl, 16 * 1024 * 1024, abort.signal, "SCUMMVM_INDEX_FETCH_FAILED");
    const game = new ScummvmFiles(index, config.contentDigest, fetch, cache, abort.signal);
    const assets = await coreAssets(base, config.selection.engineId, cache, abort.signal, reportProgress);
    Object.assign(host, {files: {stat: (path: string) => source(path).stat(path), list: (path: string) => source(path).list(path),
      read: (path: string, position: number, length: number) => source(path).read(path, position, length)}});
    const source = (path: string) => path === "/data" || path.startsWith("/data/") ? assets.data : game;
    const factory = await loader(new URL("scummvm-retrom.mjs", base).href, frameWindow);
    if (!validFactory(factory)) {throw new Error("SCUMMVM_CORE_ABI_MISMATCH");}
    const core = await factory.createScummVM({canvas, retromHost: host, noInitialRun: true, wasmBinary: assets.wasm,
      locateFile: (path: string) => new URL(path, base).href, onAbort: failed,
      onExit: (code: number) => {if (!ended) {engineStopped(code);}},
      print: (message: string) => console.debug("[scummvm]", message),
      printErr: (message: string) => console.debug("[scummvm]", message)});
    bridge.attach(core.FS);
    for (const path of ["/game", "/data", "/saves", "/plugins"]) {core.FS.mkdirTree(path);}
    core.FS.writeFile(`/${assets.plugin}`, assets.pluginBytes);
    for (const file of restore?.files ?? []) {core.FS.writeFile(`/saves/${file.path}`, file.data);}
    if (restore) {await bridge.restoreBaseline(restore.resumeSlot);}
    core.FS.writeFile("/scummvm.ini", selectionConfig(config.selection, restoreSlot));
    Promise.resolve(core.callMain(["--config=/scummvm.ini", "retrom-game"])).catch(failed);
    await timed(ready.promise, 60_000, restoreSlot !== null ? "SCUMMVM_RESTORE_TIMEOUT" : "SCUMMVM_START_TIMEOUT");
  } catch (error) {requestedExit = true; bridge.paused = false; bridge.command = 2; dispose(); throw error;}

  const setPaused = async (value: boolean) => {
    if (ending || disposed) {throw new Error("SCUMMVM_RUNTIME_STOPPED");}
    bridge.paused = value;
    if (nativePaused !== value) {
      await timed(new Promise<void>((resolve) => {pauseWaiter = {value, resolve};}), 10_000, "SCUMMVM_PAUSE_TIMEOUT");
    }
  };
  return {
    checkpoint: (request) => bridge.checkpoint(request), acknowledgeCheckpoint: (checkpoint) => bridge.acknowledge(checkpoint),
    getCheckpointAvailability: () => bridge.getAvailability(), getCanvas: () => ending || disposed ? null : canvas,
    getFrameCount: () => null, screenshot, pause: () => setPaused(true), resume: () => setPaused(false), setVolume: null,
    exit: async () => {
      if (disposed) {return;}
      requestedExit = true; bridge.paused = false; bridge.command = 2;
      if (!ended) {await timed(stopped.promise, 2000, "SCUMMVM_EXIT_TIMEOUT").catch(() => undefined);}
      void bridge.stop().catch(() => undefined); dispose();
    },
  };
}

function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {resolve = yes; reject = no;});
  // A core may fail before its asynchronous factory has returned.
  void promise.catch(() => undefined);
  return {promise, resolve, reject};
}
async function timed<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error(code)), ms);})]);}
  finally {clearTimeout(timer);}
}
