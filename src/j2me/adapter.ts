import type {CheckpointAvailability, RuntimeCheckpoint, RuntimeLoadProgress} from "../contract.js";
import type {MountedRuntimeAdapter, RuntimeProgressReporter, RuntimeExitReporter} from "../internal-adapter.js";
import type {J2meParameters} from "./parameters.js";
import {withStartupTask, type StartupTasks, type StartupTask} from "../provider/startup.js";

type J2meRuntime = Omit<MountedRuntimeAdapter, "setVolume"> & {
  mount(target: HTMLElement): Promise<void>;
  setVolume(value: number): void;
  subscribe(listener: (event: CoreEvent) => void): () => void;
};
type CoreEvent = RuntimeLoadProgress & {type: string; code?: string};
type CoreModule = {
  runtimeAdapter: {adapterAbi: string; checkpointFormat: string; automaticViewport?: boolean};
  createRuntime(config: unknown, options: unknown): J2meRuntime;
};
export type J2meModuleLoader = (url: string) => Promise<unknown>;
const format = "j2me-rms-bundle-v1";
const maximum = 2 * 1024 * 1024;

export async function mountJ2me(
  config: J2meParameters,
  target: HTMLElement,
  frameWindow: Window,
  restorePayload: Uint8Array | null,
  reportProgress: RuntimeProgressReporter,
  reportExitRequested: RuntimeExitReporter,
  reportFailure: (error: Error) => void,
  signal?: AbortSignal,
  loadModule: J2meModuleLoader = (url) => import(/* webpackIgnore: true */ /* @vite-ignore */ url),
  startup?: StartupTasks,
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document || restorePayload &&
    (!restorePayload.byteLength || restorePayload.byteLength > maximum)) {
    throw new Error("J2ME_RUNTIME_CONFIG_INVALID");
  }
  signal?.throwIfAborted();
  const runtimeBaseUrl = new URL(config.runtimeBaseUrl, window.location.href).href;
  const module = await withStartupTask(startup, "CORE_ASSETS", () => loadModule(new URL("j2me-runtime.js", runtimeBaseUrl).href));
  if (!validModule(module)) {throw new Error("J2ME_CORE_ABI_MISMATCH");}
  signal?.throwIfAborted();
  const runtime = module.createRuntime({
    sessionId: config.sessionId,
    contentDigest: config.contentDigest,
    source: {kind: "J2ME_JAR_V1", name: "game.jar", url: new URL(config.jarUrl, window.location.href).href,
      sizeBytes: config.jarSizeBytes, sha256: config.contentDigest},
    adapter: {adapterKind: "J2ME_MINIJVM_WEB", adapterId: "j2me-minijvm-web",
      runtimeBaseUrl, storage: "HOST",
      ...(module.runtimeAdapter.automaticViewport ? {} : {viewport: {width: 240, height: 320}})},
  }, {frameWindow, restorePayload, signal});
  let exited = false;
  let exitReported = false;
  const progressTasks = new Map<string, StartupTask>();
  const unsubscribe = runtime.subscribe((event) => {
    if (exited) {return;}
    if (event.type === "LOAD_PROGRESS") {
      if (startup) {
        let task = progressTasks.get(event.phase);
        if (!task) {
          task = startup.begin(event.phase === "RUNTIME_ASSET" ? "CORE_ASSETS" : event.phase === "RESTORE" ? "RESTORE_APPLY" : "GAME_CONTENT");
          progressTasks.set(event.phase, task);
        }
        task.progress(event.loadedBytes, event.totalBytes);
      }
      reportProgress(event);
    }
    if (event.type === "FATAL_ERROR") {reportFailure(new Error(event.code ?? "J2ME_RUNTIME_FAILED"));}
    if (event.type === "EXIT_REQUESTED" && !exitReported) {exitReported = true; reportExitRequested();}
  });
  const exit = async () => {
    if (exited) {return;}
    exited = true;
    unsubscribe();
    await runtime.exit();
  };
  try {
    if (typeof runtime.acknowledgeCheckpoint !== "function") {throw new Error("J2ME_CORE_ABI_MISMATCH");}
    await runtime.mount(target);
    for (const task of progressTasks.values()) {task.complete();}
  } catch (error) {for (const task of progressTasks.values()) {task.fail();} await exit(); throw error;}
  return {
    acknowledgeCheckpoint: (checkpoint) => {
      if (!runtime.acknowledgeCheckpoint) {throw new Error("J2ME_CORE_ABI_MISMATCH");}
      return runtime.acknowledgeCheckpoint(checkpoint);
    },
    checkpoint: async (): Promise<RuntimeCheckpoint> => {
      const result = await runtime.checkpoint();
      if (result.format !== format || !result.bytes?.byteLength || result.bytes.byteLength > maximum) {
        throw new Error("J2ME_CHECKPOINT_INVALID");
      }
      return {format, bytes: Uint8Array.from(result.bytes)};
    },
    exit,
    getCanvas: () => exited ? null : runtime.getCanvas(),
    getCheckpointAvailability: (): CheckpointAvailability => exited || exitReported
      ? {available: false, blocker: "NOT_READY"} : runtime.getCheckpointAvailability(),
    getFrameCount: () => runtime.getFrameCount(),
    pause: () => runtime.pause(),
    resume: () => runtime.resume(),
    screenshot: () => runtime.screenshot(),
    setVolume: (value) => runtime.setVolume(value),
  };
}

function validModule(value: unknown): value is CoreModule {
  if (!value || typeof value !== "object") {return false;}
  const module = value as Partial<CoreModule>;
  return module.runtimeAdapter?.adapterAbi === "j2me-rms" &&
    module.runtimeAdapter.checkpointFormat === format && typeof module.createRuntime === "function";
}
