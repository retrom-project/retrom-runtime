import {fetchMetadataJson, indexByteBudget} from "../provider/metadata.js";
import {KirikiriContent} from "./content.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
import type {ContentReaderV1} from "../../contracts/content-io/v1/content-io.js";
import {abi, contractSha256} from "../content-io/identity.js";
import {decodeKirikiriCheckpoint} from "./checkpoint.js";
import {createKirikiriCheckpointOperation} from "./checkpoint-operation.js";
import {KirikiriWriteOverlay} from "./write-overlay.js";
import type { MountedRuntimeAdapter, RuntimeExitReporter } from "../internal-adapter.js";
import type {KirikiriParameters} from "./parameters.js";
import {installGamepadCursor, type GamepadCursor} from "../provider/gamepad-cursor.js";
import {RuntimeFailureError} from "../provider/failure.js";

import {parseProjectIndex} from "../provider/project-index.js";
type KirikiriVlfs = {
  contentAbi: string;
  contractSha256: string;
  init(): Promise<void>;
  mkdir(path: string): number;
  onWriteClose: ((path: string, data: Uint8Array) => void) | null;
  onUnlink: ((path: string) => void) | null;
  unlink(path: string): number;
  registerOverlayFile(path: string, data: Uint8Array): unknown;
  registerContent(path: string, handle: {fileId: string; sizeBytes: number}, reader: ContentReaderV1): unknown;
  registerZipBlob(blob: Blob, options?: Record<string, unknown>): Promise<unknown>;
};
type KirikiriScriptException = {message: string; script: string; line: number; trace: string};
type KirikiriModule = {
  arguments: string[];
  retromContentBridge: {abi: string; contractSha256: string};
  PThread?: {terminateAllThreads(): void};
  canvas: HTMLCanvasElement;
  locateFile(path: string): string;
  mainScriptUrlOrBlob: string;
  onAbort(reason: unknown): void;
  onExit(status: number): void;
  onNativeExitRequested(status: number): void;
  onRuntimeInitialized(): void;
  onScriptException(detail: KirikiriScriptException): void;
  onGameSave(event: {phase: "begin" | "end"; id: number; success?: boolean}): void;
  postRun: Array<() => void>;
  preRun: Array<() => void>;
  print(message: string): void;
  printErr(message: string): void;
  pauseMainLoop(): void | Promise<void>;
  resumeMainLoop(): void;
  krkr2StopMainLoop(operation?: Promise<unknown>): Promise<void>;
  _krkr2_host_observe_game_saves(): number;
  _krkr2_host_flush_game_saves(): Promise<number>;
  _krkr2_host_finalize_native_exit(): Promise<number>;
  _krkr2_host_set_engine_mode?(mode: number): number;
  _krkr2_host_engine_arguments_abi?(): number;
  _krkr2_host_local_steam_service_abi?(): number;
  retromLocalSteamService: boolean;
  _krkr2_host_resource_overlay_abi?(): number;
  _resourceOverlayFiles: Array<{path: string; relativePath: string}>;
  _startupXp3Path?: string;
};
type KirikiriHostWindow = Window & Record<string, unknown> & {
  Module?: Partial<KirikiriModule>;
  VLFS?: KirikiriVlfs;
};

const readyTimeoutMs = 60_000;
const maximumProjectFiles = 10_000;

export async function mountKirikiri2(
  config: KirikiriParameters,
  target: HTMLElement,
  frameWindow: Window,
  restorePayload: Uint8Array | null,
  reportExitRequested: RuntimeExitReporter = () => undefined,
  contentOptions?: AdapterContentOptions & {signal?: AbortSignal},
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document) {throw new Error("KIRIKIRI_RUNTIME_TARGET_INVALID");}
  requireBrowserFeatures(frameWindow);
  if (!contentOptions) {throw new Error("CONTENT_IO_ABI_MISMATCH");}
  const content = new KirikiriContent(contentOptions, contentOptions.signal);
  const host = frameWindow as KirikiriHostWindow;
  const document = frameWindow.document;
  const surface = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.id = "canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "KiriKiri game");
  retainDisplayedWebGLFrame(canvas);
  Object.assign(surface.style, {
    alignItems: "center", display: "flex", height: "100%", justifyContent: "center", overflow: "hidden", width: "100%",
  });
  Object.assign(canvas.style, {
    background: "#000", display: "block", width: "100%", height: "100%", maxHeight: "100%", maxWidth: "100%", outline: "none", touchAction: "none",
  });
  surface.dataset.kirikiriRuntimeSurface = "";
  surface.append(canvas);
  target.replaceChildren(surface);
  const resizeCleanup = sizeCanvas(frameWindow, surface, canvas);
  const focusCanvas = () => {canvas.focus({ preventScroll: true });};
  canvas.addEventListener("pointerdown", focusCanvas, true);
  const startupKeyboardCleanup = blockStartupKeyboardInput(frameWindow);
  let gamepadCursor: GamepadCursor | undefined;
  const gamepadCleanup = () => gamepadCursor?.dispose();

  const previousModule = host.Module;
  const previousVlfs = host.VLFS;
  const scripts: HTMLScriptElement[] = [];
  const overlay = new KirikiriWriteOverlay();
  let module: KirikiriModule | null = null;
  let checkpointOperation: ReturnType<typeof createKirikiriCheckpointOperation> | undefined;
  let exited = false;
  let exitReported = false;
  let normalExitRequested = false;
  let nativeExitRequested = false;
  let finalExit: Promise<void> | undefined;
  let failed = false;
  let runtimeTerminationCleanup: () => void = () => undefined;
  const ready = deferred<void>();
  const reportFailure = (error: Error) => {
    if (failed || exitReported || exited) {return;}
    failed = true;
    ready.reject(error);
    contentOptions.onFailure?.(error);
  };
  const exportFinalExit = () => {
    if (!checkpointOperation || finalExit || failed || exited) {return;}
    // finalCheckpoint only queues work here. Its module calls run after the
    // original onExit callback returns and can drain that tick's JSPI stack.
    finalExit = checkpointOperation.finalCheckpoint(nativeExitRequested).then(async checkpoint => {
      if (failed || exited) {return;}
      const screenshot = checkpoint ? await finalCanvasScreenshot(canvas) : null;
      if (failed || exited) {return;}
      exitReported = true;
      reportExitRequested(checkpoint ? {checkpoint, screenshot} : undefined);
    }).catch(error => {
      if (!failed && !exited) {reportFailure(finalExportFailure(error, frameWindow));}
    });
  };
  const reportRuntimeExit = (nativeExit = false) => {
    if (normalExitRequested || exitReported || failed || exited) {return;}
    normalExitRequested = true;
    nativeExitRequested = nativeExit;
    exportFinalExit();
  };
  const dispose = async () => {
    // Script loading may fail before the core installs the main-loop bridge.
    // Stop scheduling first, cancel reads so a suspended JSPI tick can unwind,
    // and retain Module/VLFS until it has completely returned.
    const stopping = checkpointOperation?.stop() ?? module?.krkr2StopMainLoop?.();
    try {await content.close();}
    finally {
      await stopping;
      module?.PThread?.terminateAllThreads();
      cleanup(
        host, previousModule, previousVlfs, target, canvas, focusCanvas,
        gamepadCleanup, resizeCleanup, runtimeTerminationCleanup, scripts,
      );
    }
  };
  try {
    const base = new URL(normalizedBase(config.runtimeBaseUrl), document.baseURI);
    const assets = await content.assets(base);
    scripts.push(await loadClassicScript(document, assets.vlfsUrl));
    const vlfs = host.VLFS;
    requireVlfs(vlfs);
    await vlfs.init();
    vlfs.mkdir("/save");
    vlfs.mkdir("/savedata");
    vlfs.onWriteClose = (path, data) => overlay.record(path, data);
    vlfs.onUnlink = path => overlay.record(path, null);
    await vlfs.registerZipBlob(assets.archive, {stripPrefix: ""});
    const project = await registerProject(vlfs, config.projectIndexUrl, document.baseURI, content, config.contentDigest, config.overlayRoot, contentOptions.signal);
    const restore = restorePayload ? await decodeKirikiriCheckpoint(restorePayload) : null;
    for (const entry of restore?.entries ?? []) {
      const path = `/${entry.path}`;
      if (entry.data === null) {vlfs.unlink(path);}
      else {vlfs.registerOverlayFile(path, entry.data.slice());}
      overlay.record(path, entry.data);
    }
    if (restore) {overlay.seedProgress(restore.progressPaths);}
    runtimeTerminationCleanup = installKirikiriRuntimeTermination(frameWindow, assets.wasmUrl, error =>
      reportFailure(new RuntimeFailureError("KIRIKIRI_RUNTIME_TRAP", "CORE", [error.message], {cause: error})));
    const runtimeUrl = assets.scriptUrl;
    const options: Partial<KirikiriModule> = {
      arguments: config.engineArguments.slice(),
      retromLocalSteamService: config.steamService === "LOCAL",
      _resourceOverlayFiles: project.overlayFiles,
      retromContentBridge: {abi: content.abi, contractSha256: content.contractSha256},
      canvas,
      locateFile: (path) => path === "index.wasm" ? assets.wasmUrl : new URL(path, base).href,
      mainScriptUrlOrBlob: runtimeUrl,
      onAbort: reason => reportFailure(new RuntimeFailureError("KIRIKIRI_RUNTIME_ABORTED", "CORE",
        [typeof reason === "string" ? reason : reason instanceof Error ? reason.message : "Core aborted"])),
      onExit: status => {
        if (status === 0) {reportRuntimeExit();}
        else {reportFailure(new RuntimeFailureError("KIRIKIRI_RUNTIME_EXIT_FAILED", "CORE", [`Core exit status: ${status}`]));}
      },
      onNativeExitRequested: status => {
        if (status === 0) {reportRuntimeExit(true);}
        else {frameWindow.queueMicrotask(() => reportFailure(new RuntimeFailureError(
          "KIRIKIRI_RUNTIME_EXIT_FAILED", "CORE", [`Core exit status: ${status}`])));}
      },
      onRuntimeInitialized: () => {
        const unsupported = unsupportedNativeOptions(config, host.Module);
        if (unsupported) {
          const error = new RuntimeFailureError(unsupported, "CORE");
          reportFailure(error);
          throw error;
        }
        if (project.overlayFiles.length && host.Module?._krkr2_host_resource_overlay_abi?.() !== 1) {
          const error = new RuntimeFailureError("KIRIKIRI_RESOURCE_OVERLAY_UNSUPPORTED", "CORE");
          reportFailure(error);
          throw error;
        }
        const nativeMode = config.engineMode === "KIRIKIRI_Z" ? 1 : 0;
        const setMode = host.Module?._krkr2_host_set_engine_mode;
        if ((!setMode && nativeMode !== 0) || (setMode && setMode(nativeMode) !== 0)) {
          const error = new RuntimeFailureError("KIRIKIRI_ENGINE_MODE_UNSUPPORTED", "CORE");
          reportFailure(error);
          throw error;
        }
      },
      onScriptException: detail => {
        const error = new RuntimeFailureError("KIRIKIRI_SCRIPT_EXCEPTION", "CORE", [
          detail.message.slice(0, 2048),
          detail.script ? `${detail.script.slice(0, 1024)}:${detail.line}` : "",
          detail.trace.slice(0, 8192),
        ].filter(Boolean));
        // Let the Wasm callback return and the scheduler retain its active
        // tick before the failure lifecycle requests teardown.
        frameWindow.queueMicrotask(() => reportFailure(error));
      },
      onGameSave: event => overlay.observe(event),
      postRun: [() => {if (!failed) {ready.resolve();}}],
      preRun: [],
      print: (message) => {if (message) {console.debug(`[kirikiri2] ${message}`);}},
      printErr: (message) => {if (message) {console.debug(`[kirikiri2] ${message}`);}},
    };
    const startupPath = selectStartupPath(project.paths, config.startupXp3Path);
    if (startupPath) {options._startupXp3Path = startupPath;}
    host.Module = options;
    module = options as KirikiriModule;
    scripts.push(await loadClassicScript(document, runtimeUrl));
    module = host.Module as KirikiriModule;
    await withTimeout(ready.promise, readyTimeoutMs, "KIRIKIRI_RUNTIME_TIMEOUT");
    requireGameSaveAbi(module);
    checkpointOperation = createKirikiriCheckpointOperation({module, overlay});
    if (normalExitRequested) {exportFinalExit();}
    startupKeyboardCleanup();
    gamepadCursor = installGamepadCursor(frameWindow, canvas, {defaultEnabled: true});
    focusCanvas();
  } catch (error) {
    startupKeyboardCleanup();
    const failure = stableMountError(error);
    try {await dispose();}
    catch (cleanupError) {failure.cause = new AggregateError([error, cleanupError], "KiriKiri teardown failed");}
    throw failure;
  }

  const activeModule = module;
  const activeVlfs = host.VLFS;
  if (!activeModule || !activeVlfs) {throw new Error("KIRIKIRI_RUNTIME_ARTIFACT_INVALID");}
  return {
    canvasLayout: "CORE",
    checkpoint: async () => {
      overlay.requireValid();
      const result = await checkpointOperation!.checkpoint();
      overlay.requireValid();
      return result;
    },
    acknowledgeCheckpoint: captured => checkpointOperation!.acknowledge(captured.bytes),
    exit: async () => {
      if (exited) {return;}
      exited = true;
      await dispose();
    },
    gamepadCursor,
    touchGamepad: {layout: "POINTER"},
    getCanvas: () => canvas,
    getCheckpointAvailability: () => {
      const save = {capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false, dataKind: "PROGRESS"} as const;
      if (normalExitRequested || failed || exited) {return {available: false, blocker: "NOT_READY", save};}
      const observing = activeModule._krkr2_host_observe_game_saves();
      if (observing < 0) {
        throw new RuntimeFailureError("KIRIKIRI_GAME_SAVE_OBSERVER_FAILED", "CORE",
          [`Native save observer returned ${observing}.`]);
      }
      const blocker = observing === 1 ? overlay.availability() : "NOT_READY";
      return blocker ? {available: false, blocker, save}
        : {available: true, blocker: null, revision: String(overlay.sequence), save};
    },
    getFrameCount: () => null,
    pause: () => checkpointOperation!.pause(),
    resume: () => checkpointOperation!.resume(),
    screenshot: () => canvasScreenshot(canvas),
    setVolume: null,
  };
}

function unsupportedNativeOptions(config: KirikiriParameters, module: Partial<KirikiriModule> | undefined) {
  if (config.engineArguments.length && module?._krkr2_host_engine_arguments_abi?.() !== 1) {
    return "KIRIKIRI_ENGINE_ARGUMENTS_UNSUPPORTED";
  }
  if (config.steamService === "LOCAL" && module?._krkr2_host_local_steam_service_abi?.() !== 1) {
    return "KIRIKIRI_LOCAL_STEAM_SERVICE_UNSUPPORTED";
  }
  return null;
}

function requireGameSaveAbi(module: KirikiriModule) {
  if (typeof module._krkr2_host_observe_game_saves !== "function" ||
    typeof module._krkr2_host_flush_game_saves !== "function" ||
    typeof module._krkr2_host_finalize_native_exit !== "function") {
    throw new Error("KIRIKIRI_GAME_SAVE_ABI_UNAVAILABLE");
  }
}

async function registerProject(vlfs: KirikiriVlfs, indexUrl: string, documentBaseUrl: string,
  content: KirikiriContent, contentDigest: string, overlayRoot: string | null, signal?: AbortSignal) {
  let value: unknown;
  try {
    value = await fetchMetadataJson(new URL(indexUrl, documentBaseUrl), indexByteBudget(maximumProjectFiles, 1024), signal);
  } catch {throw new Error("KIRIKIRI_PROJECT_INDEX_UNAVAILABLE");}
  const index = parseProjectIndex(value, maximumProjectFiles, "EXACT");
  if (!index) {throw new Error("KIRIKIRI_PROJECT_INDEX_INVALID");}
  const base = new URL(indexUrl, documentBaseUrl);
  const paths: string[] = [];
  const overlayFiles: Array<{path: string; relativePath: string}> = [];
  for (const file of index.files) {
    const path = `/${file.path}`;
    const reader = content.register(contentDigest, file.path, new URL(file.url, base).href, file.sizeBytes);
    vlfs.registerContent(path, {fileId: reader.id, sizeBytes: reader.sizeBytes}, reader);
    paths.push(path);
    if (overlayRoot !== null && file.path.startsWith(`${overlayRoot}/`)) {
      overlayFiles.push({path, relativePath: file.path.slice(overlayRoot.length + 1)});
    }
  }
  if (overlayRoot !== null && !overlayFiles.length) {throw new Error("KIRIKIRI_PROJECT_OVERLAY_INVALID");}
  return {paths, overlayFiles};
}

function selectStartupPath(paths: string[], configured: string | null) {
  const sorted = paths.slice().sort((left, right) => left.localeCompare(right));
  if (configured) {
    const match = sorted.find(path => path === `/${configured}`);
    if (!match) {throw new Error("KIRIKIRI_PROJECT_ENTRY_INVALID");}
    return /(?:^|\/)startup\.tjs$/iu.test(match) ? match.slice(0, match.lastIndexOf("/") + 1) : match;
  }
  const scripts = sorted.filter(path => /^\/startup\.tjs$/iu.test(path));
  if (scripts.length === 1) {return "/";}
  const archives = sorted.filter(path => path.toLowerCase().endsWith(".xp3"));
  if (scripts.length > 1 || archives.length > 1) {throw new Error("KIRIKIRI_PROJECT_ENTRY_AMBIGUOUS");}
  return archives[0] ?? null;
}

function requireBrowserFeatures(frameWindow: Window) {
  const runtimeGlobals = frameWindow as Window & typeof globalThis;
  const wasm = runtimeGlobals.WebAssembly as typeof WebAssembly & {
    Suspending?: unknown;
    promising?: unknown;
  };
  if (!frameWindow.crossOriginIsolated || typeof runtimeGlobals.SharedArrayBuffer === "undefined" ||
    typeof wasm.Suspending !== "function" || typeof wasm.promising !== "function") {
    throw new Error("KIRIKIRI_RUNTIME_UNAVAILABLE");
  }
}

function sizeCanvas(frameWindow: Window, surface: HTMLElement, canvas: HTMLCanvasElement) {
  const resize = () => {
    const ratio = frameWindow.devicePixelRatio || 1;
    const width = Math.max(1, Math.round((surface.clientWidth || frameWindow.innerWidth || 1280) * ratio));
    const height = Math.max(1, Math.round((surface.clientHeight || frameWindow.innerHeight || 720) * ratio));
    // Assigning an unchanged dimension clears the WebGL drawing buffer. The
    // core observes backing dimensions through its existing frame-size bridge.
    if (canvas.width !== width) {canvas.width = width;}
    if (canvas.height !== height) {canvas.height = height;}
  };
  const observerType = (frameWindow as Window & typeof globalThis).ResizeObserver;
  const observer = observerType ? new observerType(resize) : undefined;
  observer?.observe(surface);
  frameWindow.addEventListener("resize", resize);
  let density: MediaQueryList | undefined;
  const watchDensity = () => {
    density?.removeEventListener("change", densityChanged);
    density = frameWindow.matchMedia?.(`(resolution: ${frameWindow.devicePixelRatio || 1}dppx)`);
    density?.addEventListener("change", densityChanged, {once: true});
  };
  const densityChanged = () => {resize(); watchDensity();};
  watchDensity();
  resize();
  return () => {
    observer?.disconnect();
    frameWindow.removeEventListener("resize", resize);
    density?.removeEventListener("change", densityChanged);
  };
}

function blockStartupKeyboardInput(frameWindow: Window) {
  const eventTypes = ["keydown", "keypress", "keyup"] as const;
  const block = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const eventType of eventTypes) {frameWindow.addEventListener(eventType, block, true);}
  return () => {
    for (const eventType of eventTypes) {frameWindow.removeEventListener(eventType, block, true);}
  };
}

function retainDisplayedWebGLFrame(canvas: HTMLCanvasElement) {
  const original = canvas.getContext.bind(canvas);
  canvas.getContext = ((kind: string, attributes?: unknown) => {
    if (["webgl", "webgl2", "experimental-webgl"].includes(kind)) {
      return original(kind as "webgl", { ...(attributes as object ?? {}), preserveDrawingBuffer: true });
    }
    return original(kind as "2d", attributes as CanvasRenderingContext2DSettings);
  }) as typeof canvas.getContext;
}

async function loadClassicScript(document: Document, source: string) {
  const script = document.createElement("script");
  script.src = source;
  script.async = false;
  script.dataset.runtime = "kirikiri2";
  const loaded = new Promise<void>((resolve, reject) => {
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("KIRIKIRI_RUNTIME_ARTIFACT_UNAVAILABLE"));
    }, { once: true });
  });
  document.head.append(script);
  await loaded;
  return script;
}

function cleanup(
  host: KirikiriHostWindow,
  previousModule: Partial<KirikiriModule> | undefined,
  previousVlfs: KirikiriVlfs | undefined,
  target: HTMLElement,
  canvas: HTMLCanvasElement,
  focusCanvas: () => void,
  gamepadCleanup: () => void,
  resizeCleanup: () => void,
  runtimeTerminationCleanup: () => void,
  scripts: HTMLScriptElement[],
) {
  if (host.VLFS) {host.VLFS.onWriteClose = null; host.VLFS.onUnlink = null;}
  for (const script of scripts) {script.remove();}
  canvas.removeEventListener("pointerdown", focusCanvas, true);
  gamepadCleanup();
  resizeCleanup();
  runtimeTerminationCleanup();
  target.replaceChildren();
  if (previousModule === undefined) {delete host.Module;} else {host.Module = previousModule;}
  if (previousVlfs === undefined) {delete host.VLFS;} else {host.VLFS = previousVlfs;}
}

function installKirikiriRuntimeTermination(
  frameWindow: Window,
  wasmUrl: string,
  reportRuntimeFailure: (error: Error) => void,
) {
  const runtimeGlobals = frameWindow as Window & typeof globalThis;
  const handleRuntimeFailure = (event: Event, error: unknown) => {
    if (!(error instanceof runtimeGlobals.WebAssembly.RuntimeError) ||
      typeof error.stack !== "string" || !error.stack.includes(`${wasmUrl}:wasm-function[`)) {return;}
    event.preventDefault();
    event.stopImmediatePropagation();
    reportRuntimeFailure(error);
  };
  const onError = (event: ErrorEvent) => handleRuntimeFailure(event, event.error);
  const onUnhandledRejection = (event: PromiseRejectionEvent) => handleRuntimeFailure(event, event.reason);
  frameWindow.addEventListener("error", onError, true);
  frameWindow.addEventListener("unhandledrejection", onUnhandledRejection, true);
  return () => {
    frameWindow.removeEventListener("error", onError, true);
    frameWindow.removeEventListener("unhandledrejection", onUnhandledRejection, true);
  };
}

function canvasScreenshot(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {if (blob) {resolve(blob);} else {reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE"));}}, "image/png");
  });
}

async function finalCanvasScreenshot(canvas: HTMLCanvasElement) {
  try {
    const image = await canvasScreenshot(canvas);
    // The public final-snapshot contract bounds PNG screenshots to 16 MiB.
    // An unavailable image must not invalidate a complete native file export.
    return image.size > 0 && image.size <= 16 * 1024 * 1024 && image.type === "image/png" ? image : null;
  } catch {return null;}
}

function finalExportFailure(error: unknown, frameWindow: Window) {
  const runtimeGlobals = frameWindow as Window & typeof globalThis;
  let cause = error;
  for (let depth = 0; cause && depth < 4; depth++) {
    if (cause instanceof runtimeGlobals.WebAssembly.RuntimeError) {
      return new RuntimeFailureError("KIRIKIRI_RUNTIME_TRAP", "CORE", [cause.message], {cause});
    }
    cause = typeof cause === "object" && "cause" in cause ? cause.cause : undefined;
  }
  return new RuntimeFailureError("KIRIKIRI_GAME_SAVE_FINAL_EXPORT_FAILED", "CORE",
    [error instanceof Error ? error.message : "Final native file export failed."], {cause: error});
}

function normalizedBase(value: string) {return value.endsWith("/") ? value : `${value}/`;}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {resolve = accept; reject = decline;});
  return { promise, reject, resolve };
}

async function withTimeout<T>(promise: Promise<T>, timeout: number, code: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {timer = setTimeout(() => reject(new Error(code)), timeout);})]);
  } finally {if (timer) {clearTimeout(timer);}}
}
function stableMountError(error: unknown) {
  return error instanceof Error && /^(?:KIRIKIRI|CONTENT_IO)_[A-Z0-9_]+$/u.test(error.message)
    ? error
    : new Error("KIRIKIRI_RUNTIME_FAILED");
}

function requireVlfs(vlfs: KirikiriVlfs | undefined): asserts vlfs is KirikiriVlfs {
  if (!vlfs || vlfs.contentAbi !== abi || vlfs.contractSha256 !== contractSha256 ||
    typeof vlfs.registerContent !== "function" || typeof vlfs.unlink !== "function") {throw new Error("CONTENT_IO_ABI_MISMATCH");}
}
