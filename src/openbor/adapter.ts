import {sha256} from "@noble/hashes/sha2.js";
import type {CheckpointAvailability, RuntimeCheckpoint} from "../contract.js";
import type {MountedRuntimeAdapter, RuntimeProgressReporter} from "../internal-adapter.js";
import {fetchPak, type PakSource} from "./fetch.js";
import {installInput} from "./input.js";
import {installCoreErrors} from "./errors.js";
import {loadModule, type OpenBOR} from "./module.js";
import {decodeSave, encodeSave, isSaveName, saveFormat, type SaveFile} from "./save.js";
export type OpenBORParameters = {pak: PakSource; runtimeBaseUrl: string};
export async function mountOpenBOR(config: OpenBORParameters, target: HTMLElement, realm: Window,
  restore: Uint8Array | null, progress: RuntimeProgressReporter, failure: (error: Error) => void,
  signal?: AbortSignal): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== realm.document) {throw new Error("OPENBOR_RUNTIME_CONFIG_INVALID");}
  const ByteArray = (realm as Window & {Uint8Array: Uint8ArrayConstructor}).Uint8Array;
  const restored = restore ? decodeSave(restore, config.pak.sha256) : [];
  let cache: CacheStorage | undefined;
  try {cache = realm.caches;} catch { /* A browser may disable persistent storage. */ }
  const bytes = await fetchPak(config.pak, progress, cache, signal);
  signal?.throwIfAborted();
  const base = new URL(config.runtimeBaseUrl, window.location.href);
  const factory = await loadModule(new URL("openbor.mjs", base).href, realm, signal);
  const canvas = realm.document.createElement("canvas");
  canvas.id = "canvas"; canvas.setAttribute("aria-label", "openbor game");
  canvas.width = 640; canvas.height = 480; canvas.tabIndex = 0;
  target.replaceChildren(canvas);
  let stopped = false, started = false, ended = false, core: OpenBOR | undefined, error: Error | undefined;
  let exitTask: Promise<void> | undefined;
  let input: ReturnType<typeof installInput> | undefined;
  const removeErrors = installCoreErrors(realm, () => {
    ended = true; error = new Error("OPENBOR_CORE_ABORTED");
    if (!stopped) {failure(error);}
  });
  const exit = () => {
    if (exitTask) {return exitTask;}
    stopped = true; input?.dispose(); removeErrors(); signal?.removeEventListener("abort", abort);
    exitTask = (async () => {
      try {
        if (core) {
          core.retromStop();
          try {if (started) {await awaitTermination(() => ended);}}
          finally {await core.retromDispose();}
        }
      } finally {canvas.remove();}
    })();
    return exitTask;
  };
  const abort = () => {void exit().catch(failure);};
  try {
    core = await factory({canvas, noInitialRun: true, locateFile: (name: string) => new URL(name, base).href,
      print: (message: string) => console.debug("OpenBOR", message), printErr: (message: string) => console.warn("OpenBOR", message),
      onAbort: () => {ended = true; error = new Error("OPENBOR_CORE_ABORTED"); if (!stopped) {failure(error);}},
      onExit: () => {ended = true; if (!stopped) {error = new Error("OPENBOR_CORE_EXITED"); logFailure(core); failure(error);}},
    });
    if (core.retromAbi !== "openbor-host-v1") {throw new Error("OPENBOR_CORE_ABI_MISMATCH");}
    signal?.throwIfAborted();
    core.FS.mkdirTree("/Paks"); core.FS.mkdirTree("/Saves"); core.FS.mkdirTree("/Logs");
    core.FS.writeFile("/Paks/game.pak", new ByteArray(bytes));
    for (const [name, data] of restored) {core.FS.writeFile(`/Saves/${name}`, new ByteArray(data));}
    input = installInput(realm, (keys) => {if (core) {core.retromKeys = keys;}});
    signal?.addEventListener("abort", abort, {once: true});
    started = true; core.callMain(["/Paks/game.pak"]);
    const deadline = performance.now() + 60_000;
    while (core.retromFrames < 2) {
      signal?.throwIfAborted();
      if (error) {throw error;}
      if (performance.now() > deadline) {throw new Error("OPENBOR_START_TIMEOUT");}
      await new Promise<void>((resolve) => realm.setTimeout(resolve, 20));
    }
    canvas.focus();
  } catch (cause) {console.warn("OpenBOR startup failed", cause); await exit(); throw cause;}
  const active = () => {if (stopped || !core || error) {throw error ?? new Error("OPENBOR_RUNTIME_STOPPED");} return core;};
  const files = (): SaveFile[] => {
    const fs = active().FS;
    return fs.readdir("/Saves").filter(isSaveName).filter((name) => {
      const info = fs.stat(`/Saves/${name}`);
      if (info.size > 10 * 1024 * 1024) {throw new Error("OPENBOR_SAVE_INVALID");}
      return info.size > 0 && fs.isFile(info.mode);
    }).sort().map((name) => [name, fs.readFile(`/Saves/${name}`)]);
  };
  let baseline = restore ? signature(encodeSave(config.pak.sha256, restored)) : "";
  const current = () => {const data = files(); return data.some(([name]) => name === "game.sav") ? encodeSave(config.pak.sha256, data) : null;};
  const availability = (): CheckpointAvailability => {
    const save = {dataKind: "PROGRESS", capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false} as const;
    if (stopped || error) {return {available: false, blocker: "NOT_READY", save};}
    try {
      const data = current();
      if (!data) {return {available: false, blocker: "NO_SAVE", save};}
      const revision = signature(data);
      return revision === baseline ? {available: false, blocker: "UNCHANGED", save} : {available: true, blocker: null, revision, save};
    } catch {return {available: false, blocker: "FAILED", save};}
  };
  return {
    exit, getCanvas: () => stopped ? null : canvas, getFrameCount: () => stopped ? null : core?.retromFrames ?? null,
    getCheckpointAvailability: availability,
    checkpoint: async () => {if (!availability().available) {throw new Error("OPENBOR_SAVE_UNAVAILABLE");} return {format: saveFormat, bytes: current()!};},
    acknowledgeCheckpoint: async (checkpoint: RuntimeCheckpoint) => {
      active(); if (checkpoint.format !== saveFormat) {throw new Error("OPENBOR_SAVE_INVALID");}
      baseline = signature(encodeSave(config.pak.sha256, decodeSave(checkpoint.bytes, config.pak.sha256)));
    },
    pause: async () => {input?.pause(); await active().retromSetPaused(true);},
    resume: async () => {await active().retromSetPaused(false); input?.resume();},
    setVolume: null,
    screenshot: async () => {
      active();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob?.size) {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
      return new Blob([await blob.arrayBuffer()], {type: "image/png"});
    },
  };
}
function signature(bytes: Uint8Array) {
  return [...sha256(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function logFailure(core: OpenBOR | undefined) {
  try {
    if (core && core.FS.stat("/Logs/OpenBorLog.txt").size <= 4 * 1024 * 1024) {
      console.warn("OpenBOR engine log", new TextDecoder().decode(core.FS.readFile("/Logs/OpenBorLog.txt")).slice(-4000));
    }
  } catch { /* A failure before log initialization has no native log. */ }
}

async function awaitTermination(ended: () => boolean) {
  const deadline = performance.now() + 2000;
  while (!ended()) {
    if (performance.now() >= deadline) {throw new Error("OPENBOR_STOP_TIMEOUT");}
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}
