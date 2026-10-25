import {RuntimeFailureError} from "../provider/failure.js";
import type {RuntimeStartupInteractionV1} from "../provider/module-api.js";
import type {CheckpointAvailability, RuntimeCheckpoint, RuntimeLoadProgress} from "../contract.js";
import type {MountedRuntimeAdapter, RuntimeProgressReporter, RuntimeExitReporter} from "../internal-adapter.js";
import type {J2meParameters} from "./parameters.js";
import {withStartupTask, type StartupTasks, type StartupTask} from "../provider/startup.js";
import {createJ2meInputState, installJ2meGamepad, type J2meInputAction} from "./input.js";
import {installJ2meTouchControls} from "./touch-controls.js";

type J2meRuntime = Omit<MountedRuntimeAdapter, "setVolume"> & {
  mount(target: HTMLElement): Promise<void>;
  setVolume(value: number): void;
  getState(): string;
  respondToStartupInteraction?(id: string, choiceId: string): void;
  setInput(action: J2meInputAction, pressed: boolean): void;
  subscribe(listener: (event: CoreEvent) => void): () => void;
};
type CoreEvent = RuntimeLoadProgress & {type: string; code?: string; reason?: string; interaction?: RuntimeStartupInteractionV1 | null};
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
  requestStartupInteraction?: (interaction: RuntimeStartupInteractionV1) => Promise<string>,
  registerStartupSession?: (session: Pick<MountedRuntimeAdapter, "exit">) => void,
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
  const runtime = module.createRuntime(coreConfiguration(config, runtimeBaseUrl, module.runtimeAdapter.automaticViewport),
    {frameWindow, restorePayload, signal});
  let exited = false;
  let exitReported = false;
  let input: ReturnType<typeof installJ2meGamepad> | undefined;
  let touch: ReturnType<typeof installJ2meTouchControls> = null;
  let inputSuspended = true, suppressed = false;
  const inputState = createJ2meInputState((action, pressed) => {
    if (runtime.getState() === "RUNNING") {runtime.setInput(action, pressed);}
  });
  const syncInput = () => {
    const enabled = !inputSuspended && !suppressed && !exited && !exitReported && runtime.getState() === "RUNNING";
    touch?.setEnabled(enabled);
    if (enabled) {input?.resume();} else {input?.pause();}
  };
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
    if (event.type === "STARTUP_INTERACTION" && event.interaction) {
      const interaction = event.interaction;
      if (!requestStartupInteraction || !runtime.respondToStartupInteraction) {
        reportFailure(new Error("J2ME_STARTUP_INTERACTION_UNAVAILABLE"));
      } else {
        void requestStartupInteraction(interaction).then(choiceId => {
          if (!exited && !signal?.aborted) {runtime.respondToStartupInteraction?.(interaction.id, choiceId);}
        }).catch(error => {if (!exited && !signal?.aborted && error?.name !== "AbortError") {reportFailure(error);}});
      }
    }
    if (event.type === "STATE_CHANGED") {syncInput();}
    if (event.type === "FATAL_ERROR") {
      inputSuspended = true; syncInput();
      reportFailure(new RuntimeFailureError(event.code ?? "J2ME_RUNTIME_FAILED", "CORE", event.reason ? [event.reason] : []));
    }
    if (event.type === "EXIT_REQUESTED" && !exitReported) {exitReported = true; syncInput(); reportExitRequested();}
  });
  const exit = async () => {
    if (exited) {return;}
    exited = true;
    unsubscribe();
    try {touch?.dispose(); input?.dispose();} finally {await runtime.exit();}
  };
  registerStartupSession?.({exit});
  try {
    if (typeof runtime.acknowledgeCheckpoint !== "function" || typeof runtime.setInput !== "function" ||
      typeof runtime.getState !== "function") {throw new Error("J2ME_CORE_ABI_MISMATCH");}
    input = installJ2meGamepad(frameWindow, (action, pressed) => inputState.set("gamepad", action, pressed),
      () => !exited && !exitReported && runtime.getState() === "RUNNING");
    touch = installJ2meTouchControls(target, frameWindow, inputState.replace, () => runtime.getCanvas()?.focus({preventScroll: true}));
    await runtime.mount(touch?.target ?? target);
    inputSuspended = false; syncInput();
    for (const task of progressTasks.values()) {task.complete();}
  } catch (error) {for (const task of progressTasks.values()) {task.fail();} await exit(); throw error;}
  return {
    canvasLayout: "CORE",
    acknowledgeCheckpoint: (checkpoint) => {
      if (!runtime.acknowledgeCheckpoint) {throw new Error("J2ME_CORE_ABI_MISMATCH");}
      return runtime.acknowledgeCheckpoint(checkpoint);
    },
    checkpoint: async (): Promise<RuntimeCheckpoint> => {
      const suspended = inputSuspended;
      inputSuspended = true; syncInput();
      try {
        const result = await runtime.checkpoint();
        if (result.format !== format || !result.bytes?.byteLength || result.bytes.byteLength > maximum) {
          throw new Error("J2ME_CHECKPOINT_INVALID");
        }
        return {format, bytes: Uint8Array.from(result.bytes)};
      } finally {
        inputSuspended = suspended; syncInput();
      }
    },
    exit,
    getCanvas: () => exited ? null : runtime.getCanvas(),
    getCheckpointAvailability: (): CheckpointAvailability => exited || exitReported
      ? {available: false, blocker: "NOT_READY"} : runtime.getCheckpointAvailability(),
    getFrameCount: () => runtime.getFrameCount(),
    pause: async () => {inputSuspended = true; syncInput(); await runtime.pause();},
    resume: async () => {await runtime.resume(); inputSuspended = false; syncInput();},
    setInputFilter: async (policy) => {suppressed = policy?.suppressInput === true; syncInput();},
    screenshot: () => runtime.screenshot(),
    setVolume: (value) => runtime.setVolume(value),
  };
}

function coreConfiguration(config: J2meParameters, runtimeBaseUrl: string, automaticViewport = false) {
  return {
    sessionId: config.sessionId,
    contentDigest: config.contentDigest,
    source: {kind: "J2ME_JAR_V1", name: "game.jar", url: new URL(config.jarUrl, window.location.href).href,
      sizeBytes: config.jarSizeBytes, sha256: config.contentDigest},
    adapter: {adapterKind: "J2ME_MINIJVM_WEB", adapterId: "j2me-minijvm-web",
      runtimeBaseUrl, storage: "HOST", ...(automaticViewport ? {} : {viewport: {width: 240, height: 320}})},
  };
}

function validModule(value: unknown): value is CoreModule {
  if (!value || typeof value !== "object") {return false;}
  const module = value as Partial<CoreModule>;
  return module.runtimeAdapter?.adapterAbi === "j2me-rms" &&
    module.runtimeAdapter.checkpointFormat === format && typeof module.createRuntime === "function";
}
