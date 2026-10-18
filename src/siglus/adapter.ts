import type {AdapterContentOptions} from "../provider/content-inputs.js";
import type {MountedRuntimeAdapter, RuntimeExitReporter} from "../internal-adapter.js";
import type {RuntimeCheckpoint} from "../contract.js";
import {loadCoreModule} from "../provider/core-module.js";
import {installGamepadCursor} from "../provider/gamepad-cursor.js";
import {SiglusContent} from "./content.js";
import {decodeSiglusSave, encodeSiglusSave, siglusSaveFormat, type SiglusSnapshot} from "./checkpoint.js";

export type SiglusParameters = {projectIndexURL: string; contentDigest: string; runtimeBaseURL: string; language: "original" | "chs"};
type Core = {abi: "siglus-host-v1"; create(options: {canvas: HTMLCanvasElement; wasmURL: string;
  files: {path: string; sizeBytes: number}[]; readFile(path: string, offset: number, length: number): Uint8Array | Promise<Uint8Array>;
  identity: string; language: string; restore: SiglusSnapshot | null;
  onFailure(error: unknown): void; onExit(): void}): Promise<Game>};
type Game = {frames(): number; status(): {progress: boolean; revision: string; changed: boolean};
  acknowledge(revision: string): void; export(): Promise<{snapshot: SiglusSnapshot; revision: string}>;
  close(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>; volume(value: number): void};

export async function mountSiglus(parameters: SiglusParameters, target: HTMLElement, frameWindow: Window,
  restore: Uint8Array | null, content: AdapterContentOptions, reportExit: RuntimeExitReporter): Promise<MountedRuntimeAdapter> {
  const identity = `${parameters.contentDigest}:${parameters.language}`;
  const snapshot = restore ? decodeSiglusSave(restore, identity) : null;
  const project = new SiglusContent(content);
  let module: Awaited<ReturnType<typeof loadCoreModule>> | undefined, game: Game | undefined;
  let cursor: ReturnType<typeof installGamepadCursor> | undefined, stopped = false, exiting = false;
  const captures = new Map<string, string>();
  const canvas = frameWindow.document.createElement("canvas");
  canvas.width = 1280; canvas.height = 720; canvas.tabIndex = 0; canvas.setAttribute("aria-label", "SiglusEngine");
  const active = () => {if (stopped || !game) {throw new Error("SIGLUS_RUNTIME_STOPPED");} return game;};
  const screenshot = () => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
    blob?.size ? resolve(blob) : reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE")), "image/png"));
  let closing: Promise<void> | undefined;
  const exit = () => closing ??= (async () => {
    stopped = true; cursor?.dispose(); content.signal?.removeEventListener("abort", abort);
    const results = await Promise.allSettled([project.close(), game?.close()]);
    module?.close(); canvas.remove();
    for (const result of results) {if (result.status === "rejected") {throw result.reason;}}
  })();
  const abort = () => {void exit().catch(error => content.onFailure?.(error as Error));};
  const checkpoint = async (): Promise<RuntimeCheckpoint> => {
    const captured = await active().export();
    const bytes = encodeSiglusSave(captured.snapshot, identity);
    captures.set(await digest(bytes), captured.revision);
    if (captures.size > 32) {captures.delete(captures.keys().next().value!);}
    return {bytes, format: siglusSaveFormat};
  };
  const onExit = () => {
    if (exiting || stopped) {return;} exiting = true;
    void (async () => {
      const saved = game?.status().progress ? await checkpoint() : null;
      const image = saved ? await screenshot() : null;
      reportExit(saved ? {checkpoint: saved, screenshot: image} : undefined);
    })().catch(error => content.onFailure?.(error as Error));
  };
  try {
    const files = await project.project(parameters.projectIndexURL, parameters.contentDigest);
    module = await loadCoreModule({content, runtimeBaseURL: parameters.runtimeBaseURL,
      assetDirectory: "assets/siglus/", files: ["siglus.mjs", "siglus_bg.wasm"], entry: "siglus.mjs",
      registration: "retromSiglus", maximum: 128 * 1024 * 1024, window: frameWindow, signal: content.signal,
      report: content.reportProgress});
    const core = module.module as Partial<Core> | null;
    if (core?.abi !== "siglus-host-v1" || typeof core.create !== "function") {throw new Error("SIGLUS_CORE_ABI_MISMATCH");}
    content.signal?.throwIfAborted(); target.append(canvas);
    game = await core.create({canvas, files, readFile: project.read, identity, language: parameters.language, restore: snapshot,
      wasmURL: module.assets["siglus_bg.wasm"], onExit, onFailure: error => {
        content.onFailure?.(error instanceof Error ? error : new Error(String(error))); abort();
      }});
    content.signal?.throwIfAborted();
    cursor = installGamepadCursor(frameWindow, canvas, {defaultEnabled: true, protocol: "pointer"});
    content.signal?.addEventListener("abort", abort, {once: true}); canvas.focus();
  } catch (error) {await exit(); throw error;}
  return {
    exit, checkpoint, gamepadCursor: cursor,
    acknowledgeCheckpoint: async captured => {
      const revision = captures.get(await digest(captured.bytes));
      if (revision !== undefined) {active().acknowledge(revision);}
    },
    getCanvas: () => stopped ? null : canvas, getFrameCount: () => game?.frames() ?? null,
    getCheckpointAvailability: () => {
      if (stopped || exiting || !game) {return {available: false, blocker: "NOT_READY"};}
      const status = game.status();
      const save = {capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false, dataKind: "PROGRESS"} as const;
      if (!status.progress) {return {available: false, blocker: "NO_SAVE", save};}
      if (!status.changed) {return {available: false, blocker: "UNCHANGED", save};}
      return {available: true, blocker: null, revision: status.revision, save};
    },
    screenshot,
    pause: async () => {cursor?.setSuspended(true); await active().pause();},
    resume: async () => {await active().resume(); cursor?.setSuspended(false);},
    setVolume: value => active().volume(value),
  };
}

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
