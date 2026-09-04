import { decodeKirikiriCheckpoint, encodeKirikiriCheckpoint, type KirikiriCheckpointEntry } from "./checkpoint.js";
import type { MountedRuntimeAdapter, RuntimeExitReporter } from "../internal-adapter.js";
import type { KirikiriRuntimeConfig } from "./contract.js";
import { installKirikiriStandardGamepad } from "./gamepad-input.js";

type KirikiriConfig = KirikiriRuntimeConfig & { adapter: KirikiriRuntimeConfig["adapter"] };
type ProjectFile = { path: string; url: string; sizeBytes: number };
type ProjectIndex = { schemaVersion: 1; files: ProjectFile[] };
type KirikiriVlfs = {
  init(): Promise<void>;
  mkdir(path: string): number;
  onWriteClose: ((path: string, data: Uint8Array) => void) | null;
  registerOverlayFile(path: string, data: Uint8Array): unknown;
  registerRemote(path: string, url: string, size: number, supportsRanges: boolean): unknown;
  registerZipBlob(blob: Blob, options?: Record<string, unknown>): Promise<unknown>;
};
type KirikiriModule = {
  arguments: string[];
  canvas: HTMLCanvasElement;
  locateFile(path: string): string;
  mainScriptUrlOrBlob: string;
  onAbort(reason: unknown): void;
  onExit(status: number): void;
  onRuntimeInitialized(): void;
  postRun: Array<() => void>;
  preRun: Array<() => void>;
  print(message: string): void;
  printErr(message: string): void;
  pauseMainLoop(): void;
  resumeMainLoop(): void;
  _krkr2_host_bookmark_is_ready(): number;
  _krkr2_host_load_bookmark(slot: number): number;
  _krkr2_host_load_bookmark_state(): number;
  _krkr2_host_save_bookmark(slot: number): number;
  _startupXp3Path?: string;
};
type KirikiriHostWindow = Window & Record<string, unknown> & {
  Module?: Partial<KirikiriModule>;
  VLFS?: KirikiriVlfs;
};

const readyTimeoutMs = 60_000;
const writeTimeoutMs = 10_000;
const writeQuiescenceMs = 250;
const maximumProjectFiles = 10_000;
const saveRoots = ["/save/", "/savedata/"] as const;
const runtimeTerminationTraps = new Set([
  "null function",
  "function signature mismatch",
  "null function or function signature mismatch",
  "table index is out of bounds",
]);

export async function mountKirikiri2(
  config: KirikiriConfig,
  target: HTMLElement,
  frameWindow: Window,
  restorePayload: Uint8Array | null,
  reportExitRequested: RuntimeExitReporter = () => undefined,
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document) {throw new Error("KIRIKIRI_RUNTIME_TARGET_INVALID");}
  requireBrowserFeatures(frameWindow);
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
    background: "#000", display: "block", maxHeight: "100%", maxWidth: "100%", outline: "none", touchAction: "none",
  });
  surface.dataset.kirikiriRuntimeSurface = "";
  surface.append(canvas);
  target.replaceChildren(surface);
  sizeCanvas(frameWindow, surface, canvas);
  const focusCanvas = () => {canvas.focus({ preventScroll: true });};
  canvas.addEventListener("pointerdown", focusCanvas, true);
  const startupKeyboardCleanup = blockStartupKeyboardInput(frameWindow);
  let gamepadCleanup: () => void = () => undefined;

  const previousModule = host.Module;
  const previousVlfs = host.VLFS;
  const scripts: HTMLScriptElement[] = [];
  const writes = new Map<string, Uint8Array>();
  const writeSequences = new Map<string, number>();
  let writeSequence = 0;
  let lastWriteAt = 0;
  let module: KirikiriModule | null = null;
  let paused = false;
  let exited = false;
  let exitReported = false;
  let runtimeTerminationCleanup: () => void = () => undefined;
  const reportRuntimeExit = () => {
    if (exitReported) {return;}
    exitReported = true;
    reportExitRequested();
  };
  try {
    const base = new URL(normalizedBase(config.adapter.runtimeBaseUrl), document.baseURI);
    runtimeTerminationCleanup = installKirikiriRuntimeTermination(
      frameWindow,
      new URL("index.wasm", base).href,
      reportRuntimeExit,
    );
    scripts.push(await loadClassicScript(document, new URL("vlfs.js", base).href));
    const vlfs = host.VLFS;
    if (!vlfs) {throw new Error("KIRIKIRI_RUNTIME_ARTIFACT_INVALID");}
    await vlfs.init();
    vlfs.mkdir("/save");
    vlfs.mkdir("/savedata");
    vlfs.onWriteClose = (path, data) => {
      if (!isSavePath(path)) {return;}
      const normalized = normalizeSavePath(path);
      writes.set(normalized, data.slice());
      writeSequence += 1;
      writeSequences.set(normalized, writeSequence);
      lastWriteAt = Date.now();
    };
    await registerRuntimeAssets(vlfs, new URL("assets.zip", base));
    const project = await registerProject(vlfs, config.adapter.projectIndexUrl, document.baseURI);
    const restore = restorePayload ? await decodeKirikiriCheckpoint(restorePayload) : null;
    for (const entry of restore?.entries ?? []) {
      const path = `/${entry.path}`;
      vlfs.registerOverlayFile(path, entry.data.slice());
      writes.set(entry.path, entry.data.slice());
    }
    const ready = deferred<void>();
    const runtimeUrl = new URL("index.js", base).href;
    const options: Partial<KirikiriModule> = {
      arguments: [],
      canvas,
      locateFile: (path) => new URL(path, base).href,
      mainScriptUrlOrBlob: runtimeUrl,
      onAbort: () => {ready.reject(new Error("KIRIKIRI_RUNTIME_ABORTED"));},
      onExit: reportRuntimeExit,
      onRuntimeInitialized: () => undefined,
      postRun: [() => {ready.resolve();}],
      preRun: [],
      print: (message) => {if (message) {console.debug(`[kirikiri2] ${message}`);}},
      printErr: (message) => {if (message) {console.debug(`[kirikiri2] ${message}`);}},
    };
    const startupPath = selectStartupXp3(project.xp3Paths, config.adapter.startupXp3Path);
    if (startupPath) {options._startupXp3Path = startupPath;}
    host.Module = options;
    scripts.push(await loadClassicScript(document, runtimeUrl));
    module = host.Module as KirikiriModule;
    await withTimeout(ready.promise, readyTimeoutMs, "KIRIKIRI_RUNTIME_TIMEOUT");
    if (restore) {
      await waitFor(() => module?._krkr2_host_bookmark_is_ready?.() === 1, readyTimeoutMs);
      await restoreBookmark(module, config.adapter.checkpointSlot);
    }
    startupKeyboardCleanup();
    gamepadCleanup = installKirikiriStandardGamepad(frameWindow, surface, canvas);
    focusCanvas();
  } catch (error) {
    startupKeyboardCleanup();
    cleanup(
      host, previousModule, previousVlfs, target, canvas, focusCanvas,
      gamepadCleanup, runtimeTerminationCleanup, scripts,
    );
    throw stableMountError(error);
  }

  const activeModule = module;
  const activeVlfs = host.VLFS;
  if (!activeModule || !activeVlfs) {throw new Error("KIRIKIRI_RUNTIME_ARTIFACT_INVALID");}
  return {
    checkpoint: async () => {
      if (exited) {throw new Error("KIRIKIRI_RUNTIME_INVALID_STATE");}
      const wasPaused = paused;
      let pausedForCapture = false;
      if (wasPaused) {activeModule.resumeMainLoop();}
      try {
        await waitFor(() => activeModule._krkr2_host_bookmark_is_ready() === 1, readyTimeoutMs);
        if (exited) {throw new Error("KIRIKIRI_RUNTIME_INVALID_STATE");}
        const checkpointWriteSequence = writeSequence;
        if (activeModule._krkr2_host_save_bookmark(config.adapter.checkpointSlot) !== 0) {
          throw new Error("KIRIKIRI_CHECKPOINT_CREATE_FAILED");
        }
        await waitFor(
          () => hasCausalBookmarkWrite(writeSequences, checkpointWriteSequence) &&
            Date.now() - lastWriteAt >= writeQuiescenceMs,
          writeTimeoutMs,
        );
        activeModule.pauseMainLoop();
        pausedForCapture = true;
        const entries: KirikiriCheckpointEntry[] = [...writes].map(([path, data]) => ({ path, data: data.slice() }));
        return {
          bytes: await encodeKirikiriCheckpoint({ entries, resumeSlot: config.adapter.checkpointSlot }),
          format: "kirikiri-save-bundle-v1",
        };
      } catch (error) {
        if (error instanceof Error && ["KIRIKIRI_CHECKPOINT_CREATE_FAILED", "KIRIKIRI_RUNTIME_INVALID_STATE"]
          .includes(error.message)) {throw error;}
        throw new Error("KIRIKIRI_CHECKPOINT_CREATE_FAILED");
      } finally {
        if (wasPaused && !pausedForCapture) {activeModule.pauseMainLoop();}
        if (!wasPaused && pausedForCapture) {activeModule.resumeMainLoop();}
      }
    },
    exit: async () => {
      if (exited) {return;}
      exited = true;
      activeModule.pauseMainLoop();
      cleanup(
        host, previousModule, previousVlfs, target, canvas, focusCanvas,
        gamepadCleanup, runtimeTerminationCleanup, scripts,
      );
    },
    getCanvas: () => canvas,
    getCheckpointAvailability: () => activeModule._krkr2_host_bookmark_is_ready() === 1
      ? { available: true, blocker: null }
      : { available: false, blocker: "NOT_READY" },
    getFrameCount: () => null,
    getValidationProbe: () => null,
    pause: async () => {activeModule.pauseMainLoop(); paused = true;},
    resume: async () => {activeModule.resumeMainLoop(); paused = false;},
    screenshot: () => canvasScreenshot(canvas),
    setVolume: null,
  };
}

async function restoreBookmark(module: KirikiriModule, slot: number) {
  if (module._krkr2_host_load_bookmark(slot) !== 0) {
    throw new Error("KIRIKIRI_CHECKPOINT_RESTORE_FAILED");
  }
  try {
    await waitFor(() => module._krkr2_host_load_bookmark_state() !== 1, readyTimeoutMs);
  } catch {
    throw new Error("KIRIKIRI_CHECKPOINT_RESTORE_FAILED");
  }
  if (module._krkr2_host_load_bookmark_state() !== 2) {
    throw new Error("KIRIKIRI_CHECKPOINT_RESTORE_FAILED");
  }
  try {
    await waitFor(() => module._krkr2_host_bookmark_is_ready() === 1, readyTimeoutMs);
  } catch {
    throw new Error("KIRIKIRI_CHECKPOINT_RESTORE_FAILED");
  }
}

async function registerRuntimeAssets(vlfs: KirikiriVlfs, url: URL) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {throw new Error("KIRIKIRI_RUNTIME_ARTIFACT_UNAVAILABLE");}
  await vlfs.registerZipBlob(await response.blob(), { stripPrefix: "" });
}

async function registerProject(vlfs: KirikiriVlfs, indexUrl: string, documentBaseUrl: string) {
  let value: unknown;
  try {
    const response = await fetch(indexUrl, { credentials: "same-origin" });
    if (!response.ok) {throw new Error("response");}
    value = await response.json();
  } catch {throw new Error("KIRIKIRI_PROJECT_INDEX_UNAVAILABLE");}
  if (!validProjectIndex(value)) {throw new Error("KIRIKIRI_PROJECT_INDEX_INVALID");}
  const base = new URL(indexUrl, documentBaseUrl);
  const xp3Paths: string[] = [];
  for (const file of value.files) {
    const path = `/${file.path}`;
    vlfs.registerRemote(path, new URL(file.url, base).href, file.sizeBytes, true);
    if (file.path.toLowerCase().endsWith(".xp3")) {xp3Paths.push(path);}
  }
  return { xp3Paths };
}

function validProjectIndex(value: unknown): value is ProjectIndex {
  if (!isRecord(value) || !exactKeys(value, ["files", "schemaVersion"]) || value.schemaVersion !== 1 ||
    !Array.isArray(value.files) || value.files.length < 1 || value.files.length > maximumProjectFiles) {return false;}
  const seen = new Set<string>();
  for (const file of value.files) {
    if (!isRecord(file) || !exactKeys(file, ["path", "sizeBytes", "url"]) || !validPath(file.path) ||
      !validProjectUrl(file.url) || typeof file.sizeBytes !== "number" ||
      !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {return false;}
    const identity = file.path.toLowerCase();
    if (seen.has(identity)) {return false;}
    seen.add(identity);
  }
  return true;
}

function selectStartupXp3(paths: string[], configured: string | null) {
  const sorted = paths.slice().sort((left, right) => left.localeCompare(right));
  if (configured) {
    const expected = `/${configured}`.toLowerCase();
    const match = sorted.find((path) => path.toLowerCase() === expected);
    if (!match) {throw new Error("KIRIKIRI_PROJECT_ENTRY_INVALID");}
    return match;
  }
  if (sorted.length > 1) {throw new Error("KIRIKIRI_PROJECT_ENTRY_AMBIGUOUS");}
  return sorted[0] ?? null;
}

function isSavePath(path: string) {return saveRoots.some((root) => path.toLowerCase().startsWith(root));}
function normalizeSavePath(path: string) {return path.replace(/^\/+/, "").normalize("NFC");}
function hasCausalBookmarkWrite(sequences: Map<string, number>, checkpointWriteSequence: number) {
  for (const [path, sequence] of sequences) {
    if (sequence > checkpointWriteSequence && !isBookmarkBookkeepingPath(path)) {return true;}
  }
  return false;
}
function isBookmarkBookkeepingPath(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return /^datas[cu](?:[_~])?\.ksd$/iu.test(name);
}
function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && value.normalize("NFC") === value &&
    !value.startsWith("/") && !value.includes("\\") && !value.includes("//") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
function validProjectUrl(value: unknown) {
  if (typeof value !== "string") {return false;}
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes("#")) {return true;}
  try {return ["http:", "https:"].includes(new URL(value).protocol);} catch {return false;}
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
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
    canvas.width = Math.max(1, Math.round((surface.clientWidth || 1280) * ratio));
    canvas.height = Math.max(1, Math.round((surface.clientHeight || 720) * ratio));
  };
  resize();
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
    script.addEventListener("error", () => reject(new Error("KIRIKIRI_RUNTIME_ARTIFACT_UNAVAILABLE")), { once: true });
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
  runtimeTerminationCleanup: () => void,
  scripts: HTMLScriptElement[],
) {
  if (host.VLFS) {host.VLFS.onWriteClose = null;}
  for (const script of scripts) {script.remove();}
  canvas.removeEventListener("pointerdown", focusCanvas, true);
  gamepadCleanup();
  runtimeTerminationCleanup();
  target.replaceChildren();
  if (previousModule === undefined) {delete host.Module;} else {host.Module = previousModule;}
  if (previousVlfs === undefined) {delete host.VLFS;} else {host.VLFS = previousVlfs;}
}

function installKirikiriRuntimeTermination(
  frameWindow: Window,
  wasmUrl: string,
  reportRuntimeExit: () => void,
) {
  const runtimeGlobals = frameWindow as Window & typeof globalThis;
  const handleRuntimeFailure = (event: Event, error: unknown) => {
    if (!(error instanceof runtimeGlobals.WebAssembly.RuntimeError) || !runtimeTerminationTraps.has(error.message) ||
      typeof error.stack !== "string" || !error.stack.includes(`${wasmUrl}:wasm-function[`)) {return;}
    event.preventDefault();
    event.stopImmediatePropagation();
    reportRuntimeExit();
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

function normalizedBase(value: string) {return value.endsWith("/") ? value : `${value}/`;}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {resolve = accept; reject = decline;});
  return { promise, reject, resolve };
}
async function waitFor(predicate: () => boolean, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) {return;}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("KIRIKIRI_RUNTIME_TIMEOUT");
}
async function withTimeout<T>(promise: Promise<T>, timeout: number, code: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {timer = setTimeout(() => reject(new Error(code)), timeout);})]);
  } finally {if (timer) {clearTimeout(timer);}}
}
function stableMountError(error: unknown) {
  return error instanceof Error && /^KIRIKIRI_[A-Z0-9_]+$/u.test(error.message)
    ? error
    : new Error("KIRIKIRI_RUNTIME_FAILED");
}
