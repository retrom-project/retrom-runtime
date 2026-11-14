import type {AdapterContentOptions} from "./content-inputs.js";
import type {MountedRuntimeAdapter, RuntimeExitReporter} from "../internal-adapter.js";
import type {RuntimeCheckpoint} from "../contract.js";
import {loadCoreModule} from "./core-module.js";
import {installGamepadCursor} from "./gamepad-cursor.js";
import {touchGamepadProfiles} from "./touch-gamepad-layout.js";
import type {IndexedProjectContent} from "./indexed-project-content.js";
export type FileSaveGame<S> = {frames(): number; status(): {progress: boolean; revision: string; changed: boolean};
  acknowledge(revision: string): void; export(): Promise<{snapshot: S; revision: string}>;
  close(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>; volume(value: number): void;
  screenshot?(): Promise<Blob>};
type FileSaveCore<S> = {abi: string; create(options: Record<string, unknown>): Promise<FileSaveGame<S>>};
type Options<S> = {parameters: {projectIndexURL: string; contentDigest: string; runtimeBaseURL: string};
  target: HTMLElement; frameWindow: Window; restore: Uint8Array | null; content: AdapterContentOptions; reportExit: RuntimeExitReporter;
  identity: string; project: IndexedProjectContent; abi: string; prefix: string; displayName: string;
  assetDirectory: string; assets: string[]; entry: string; registration: string;
  assetArguments: Record<string, string>; coreOptions: Record<string, unknown>;
  codec: {format: string; encode(snapshot: S, identity: string): Uint8Array; decode(bytes: Uint8Array, identity: string): S}};
/** One lifecycle for cores exposing native-file progress and host-owned persistence. */
export async function mountFileSaveCore<S>(options: Options<S>): Promise<MountedRuntimeAdapter> {
  const {parameters, target, frameWindow, restore, content, reportExit, identity} = options;
  const project = options.project;
  let snapshot: S | null;
  try {snapshot = restore ? options.codec.decode(restore, identity) : null;}
  catch (error) {await project.close(); throw error;}
  let module: Awaited<ReturnType<typeof loadCoreModule>> | undefined, game: FileSaveGame<S> | undefined;
  let cursor: ReturnType<typeof installGamepadCursor> | undefined, stopped = false, exiting = false;
  const captures = new Map<string, string>();
  const canvas = frameWindow.document.createElement("canvas");
  canvas.width = 1280; canvas.height = 720; canvas.tabIndex = 0; canvas.setAttribute("aria-label", options.displayName);
  const active = () => {if (stopped || !game) {throw new Error(`${options.prefix}_RUNTIME_STOPPED`);} return game;};
  const screenshot = () => game?.screenshot ? game.screenshot() : new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
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
    const bytes = options.codec.encode(captured.snapshot, identity);
    captures.set(await digest(bytes), captured.revision);
    if (captures.size > 32) {captures.delete(captures.keys().next().value!);}
    return {bytes, format: options.codec.format};
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
      assetDirectory: options.assetDirectory, files: options.assets, entry: options.entry,
      registration: options.registration, maximum: 128 * 1024 * 1024, window: frameWindow, signal: content.signal,
      report: content.reportProgress});
    const core = module.module as Partial<FileSaveCore<S>> | null;
    if (core?.abi !== options.abi || typeof core.create !== "function") {throw new Error(`${options.prefix}_CORE_ABI_MISMATCH`);}
    content.signal?.throwIfAborted(); target.append(canvas);
    game = await core.create({canvas, files, readFile: project.read, identity, ...options.coreOptions, restore: snapshot,
      ...Object.fromEntries(Object.entries(options.assetArguments).map(([key, name]) => [key, module!.assets[name]])), onExit, onFailure: (error: unknown) => {
        content.onFailure?.(error instanceof Error ? error : new Error(String(error))); abort();
      }});
    content.signal?.throwIfAborted();
    cursor = installGamepadCursor(frameWindow, canvas, {defaultEnabled: true, protocol: "pointer"});
    content.signal?.addEventListener("abort", abort, {once: true}); canvas.focus();
  } catch (error) {await exit(); throw error;}
  return {
    touchGamepad: touchGamepadProfiles.analogMenu,
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
