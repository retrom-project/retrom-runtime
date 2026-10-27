import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {fetchMetadataJson, indexByteBudget} from "../provider/metadata.js";
import { decodeOnsCheckpoint, encodeOnsCheckpoint, onsGameSaveFormat, type OnsCheckpointBundle } from "./checkpoint.js";
import type {RuntimeCheckpoint} from "../contract.js";
import type { MountedRuntimeAdapter, RuntimeExitReporter, RuntimeProgressReporter } from "../internal-adapter.js";
import type {OnsParameters} from "./parameters.js";
import { installOnsAnalogGamepad } from "./gamepad-input.js";
import {waitForOnsEngine} from "./startup.js";
import {
  createOnsProjectFileMap,
  type OnsContentBridge,
  type OnsProjectFile,
  type OnsProjectFileNode,
} from "./project-files.js";

import {parseProjectIndex, type ProjectIndex} from "../provider/project-index.js";

type OnsFileSystem = {
  isDir(mode: number): boolean;
  mkdirTree(path: string): void;
  readFile(path: string): Uint8Array;
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  writeFile(path: string, bytes: Uint8Array): void;
};

type OnsModule = {
  FS: OnsFileSystem;
  callMain(args: string[]): void | Promise<void>;
  canvas: HTMLCanvasElement;
  locateFile(path: string): string;
  onExit?(status: number): void;
  onAbort?(reason: unknown): void;
  preRun?(): void;
  printErr?(message: string): void;
  wait_video?: boolean;
  _onsyuri_host_is_ready(): number;
  _onsyuri_host_set_paused(paused: number): void;
  _onsyuri_host_stop(): void;
};

type OnsFactory = (options: Partial<OnsModule>) => Promise<OnsModule>;
type OnsHostWindow = Window & Record<string, unknown> & {
  onsyuri?: OnsFactory;
  onsyuriHostReady?: () => void;
  g_onsyuri_content?: OnsContentBridge;
};

const gameRoot = "/game";
const saveRoot = "/save";
const maximumCheckpointBytes = 64 * 1024 * 1024;
const maximumProjectFiles = 100_000;

export async function mountOnsYuri(
  config: OnsParameters,
  target: HTMLElement,
  frameWindow: Window,
  restorePayload: Uint8Array | null,
  reportProgress: RuntimeProgressReporter = () => undefined,
  reportExitRequested: RuntimeExitReporter = () => undefined,
  content?: AdapterContentOptions & {signal?: AbortSignal; onFailure?: (error: Error) => void},
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document) {throw new Error("ONS_RUNTIME_TARGET_INVALID");}
  reportProgress({ phase: "PROJECT_INDEX", loadedBytes: 0, totalBytes: null });
  const index = await loadProjectIndex(config.projectIndexUrl, content?.signal);
  reportProgress({ phase: "PROJECT_INDEX", loadedBytes: 1, totalBytes: 1 });
  const restore = await readRestore(restorePayload);
  const host = frameWindow as OnsHostWindow;
  const document = frameWindow.document;
  const surface = document.createElement("div");
  const canvas = document.createElement("canvas");
  const video = document.createElement("video");
  canvas.id = "canvas";
  retainDisplayedWebGLFrame(canvas);
  surface.dataset.onsRuntimeSurface = "";
  Object.assign(surface.style, {
    display: "grid", height: "100%", overflow: "hidden", placeItems: "center", width: "100%",
  });
  Object.assign(canvas.style, { gridArea: "1 / 1", maxHeight: "100%", maxWidth: "100%" });
  Object.assign(video.style, { gridArea: "1 / 1", maxHeight: "100%", maxWidth: "100%" });
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "ONScripter game");
  video.hidden = true;
  surface.append(canvas, video);
  target.replaceChildren(surface);
  const focusCanvas = () => {
    canvas.focus({ preventScroll: true });
  };
  canvas.addEventListener("pointerdown", focusCanvas, true);
  const gamepadCleanup = installOnsAnalogGamepad(frameWindow, canvas);

  const globals = captureGlobals(host);
  const ready = deferred<void>();
  void ready.promise.catch(() => undefined);
  const projectFiles = createOnsProjectFileMap(index.files, frameWindow, reportProgress, content && {...content,
    projectDigest: config.contentDigest, onFailure: error => {ready.reject(error); content.onFailure?.(error);}});
  const fileMap = projectFiles.fileMap;
  let module: OnsModule | null = null;
  let exited = false;
  let nativeExitRequested = false;
  let hasProgress = restore !== null;
  let revision = 0;
  let acknowledged = 0;
  const captures = new Map<string, number>();
  let videoCleanup: () => void = () => undefined;
  const base = new URL(normalizedBase(config.runtimeBaseUrl), document.baseURI).href;
  const moduleOptions: Partial<OnsModule> = {
    canvas,
    locateFile: (path) => new URL(path, base).href,
    onExit: () => {
      if (exited || nativeExitRequested) {return;}
      nativeExitRequested = true;
      // Leave the native callback before exporting the completed save files.
      void Promise.resolve().then(async () => {
        const checkpoint = hasProgress && revision > acknowledged ? await capture() : null;
        const screenshot = checkpoint ? await canvasScreenshot(canvas).catch(() => null) : null;
        reportExitRequested(checkpoint ? {checkpoint, screenshot} : undefined);
      }).catch(error => content?.onFailure?.(error instanceof Error ? error : new Error(String(error))));
    },
    onAbort: () => ready.reject(new Error("ONS_RUNTIME_ABORTED")),
    preRun: () => {
      const current = host.g_onsyuri_module as OnsModule | undefined;
      if (!current?.FS) {throw new Error("ONS_RUNTIME_FILESYSTEM_UNAVAILABLE");}
      prepareFileSystem(current.FS, index.files, restore);
    },
    printErr: (message) => {if (message) {console.debug(`[ons-yuri] ${message}`);}},
  };
  host.g_onsyuri_module = moduleOptions;
  // The core's fopen() reads project files through this bridge, one byte range at a time.
  host.g_onsyuri_content = projectFiles.bridge;
  // The native writeSaveFile calls this only after its slot and compatibility
  // sidecar have both been written successfully. Settings writes do not call it.
  host.flush_save = () => {if (!exited) {hasProgress = true; revision++;}};
  host.onsyuriHostReady = () => ready.resolve();
  host.scale_full = (element: HTMLElement, ratio = 0) => scaleToFrame(frameWindow, element, ratio);

  let script: HTMLScriptElement | null = null;
  try {
    script = await loadRuntimeScript(document, new URL("onsyuri.js", base).href);
    if (typeof host.onsyuri !== "function") {throw new Error("ONS_RUNTIME_ARTIFACT_INVALID");}
    module = await host.onsyuri(moduleOptions);
    if (typeof module._onsyuri_host_is_ready !== "function" || typeof module._onsyuri_host_stop !== "function") {
      throw new Error("ONS_RUNTIME_ARTIFACT_INVALID");
    }
    host.g_onsyuri_module = module;
    videoCleanup = installVideo(host, module, video, canvas, fileMap, projectFiles.videoSource);
    const started = module.callMain(runtimeArgs(config, index));
    void Promise.resolve(started).catch(error => {if (!exited) {ready.reject(error);}});
    const startingModule = module;
    await waitForOnsEngine(ready.promise, () => startingModule._onsyuri_host_is_ready() === 1,
      projectFiles.hasPendingReads, content?.signal);
    focusCanvas();
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }

  async function cleanup() {
    exited = true;
    try {if (module && typeof module._onsyuri_host_stop === "function") {stopEngine(module);}}
    finally {
      videoCleanup();
      await projectFiles.close();
      gamepadCleanup();
      script?.remove();
      canvas.removeEventListener("pointerdown", focusCanvas, true);
      target.replaceChildren();
      restoreGlobals(host, globals);
    }
  }

  const activeModule = module;
  async function capture(): Promise<RuntimeCheckpoint> {
    if (exited || !module) {throw new Error("ONS_RUNTIME_INVALID_STATE");}
    if (!hasProgress || revision <= acknowledged) {throw new Error("ONS_NO_SAVE");}
    const capturedRevision = revision;
    // Copy the complete directory synchronously; hashing may yield to a later save.
    const entries = collectFiles(module.FS, saveRoot);
    const bytes = await encodeOnsCheckpoint({entries});
    const key = await checkpointDigest(bytes);
    if (exited) {throw new Error("ONS_RUNTIME_INVALID_STATE");}
    captures.set(key, capturedRevision);
    if (captures.size > 32) {captures.delete(captures.keys().next().value!);}
    return {bytes, format: onsGameSaveFormat};
  }
  return {
    checkpoint: async () => {
      if (nativeExitRequested) {throw new Error("ONS_RUNTIME_INVALID_STATE");}
      return capture();
    },
    acknowledgeCheckpoint: async captured => {
      if (exited) {throw new Error("ONS_RUNTIME_INVALID_STATE");}
      const capturedRevision = captures.get(await checkpointDigest(captured.bytes));
      if (capturedRevision !== undefined) {acknowledged = Math.max(acknowledged, capturedRevision);}
    },
    exit: async () => {
      if (exited) {return;}
      await cleanup();
    },
    getCanvas: () => canvas,
    getCheckpointAvailability: () => {
      const save = {capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false, dataKind: "PROGRESS"} as const;
      if (exited || nativeExitRequested) {return {available: false, blocker: "NOT_READY", save};}
      if (!hasProgress) {return {available: false, blocker: "NO_SAVE", save};}
      if (revision <= acknowledged) {return {available: false, blocker: "UNCHANGED", save};}
      return {available: true, blocker: null, revision: String(revision), save};
    },
    getFrameCount: () => null,
    pause: async () => {activeModule._onsyuri_host_set_paused(1);},
    resume: async () => {activeModule._onsyuri_host_set_paused(0);},
    screenshot: () => canvasScreenshot(canvas),
    setVolume: null,
  };
}

async function loadProjectIndex(url: string, signal?: AbortSignal): Promise<ProjectIndex> {
  let value: unknown;
  try {
    value = await fetchMetadataJson(url, indexByteBudget(maximumProjectFiles, 1024), signal);
  } catch {throw new Error("ONS_PROJECT_INDEX_UNAVAILABLE");}
  const index = parseProjectIndex(value, maximumProjectFiles, "UNIQUE_FOLDED");
  if (!index) {throw new Error("ONS_PROJECT_INDEX_INVALID");}
  return index;
}

function prepareFileSystem(fs: OnsFileSystem, files: OnsProjectFile[], restore: OnsCheckpointBundle | null) {
  fs.mkdirTree(gameRoot);
  fs.mkdirTree(saveRoot);
  for (const file of files) {fs.mkdirTree(parentPath(`${gameRoot}/${file.path}`));}
  if (!restore) {return;}
  for (const entry of restore.entries) {
    const path = `${saveRoot}/${entry.path}`;
    fs.mkdirTree(parentPath(path));
    fs.writeFile(path, entry.data);
  }
}

function collectFiles(fs: OnsFileSystem, root: string) {
  const entries: Array<{ path: string; data: Uint8Array }> = [];
  let total = 0;
  const visit = (directory: string, prefix: string) => {
    for (const name of fs.readdir(directory).filter((value) => value !== "." && value !== "..").sort()) {
      const path = `${directory}/${name}`;
      const relative = prefix ? `${prefix}/${name}` : name;
      if (fs.isDir(fs.stat(path).mode)) {visit(path, relative); continue;}
      const data = fs.readFile(path).slice();
      total += data.byteLength;
      if (entries.length >= 512 || total > maximumCheckpointBytes) {throw new Error("ONS_CHECKPOINT_CREATE_FAILED");}
      entries.push({ path: relative, data });
    }
  };
  visit(root, "");
  return entries;
}

function installVideo(
  host: OnsHostWindow,
  module: OnsModule,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  fileMap: Record<string, OnsProjectFileNode>,
  source?: (node: OnsProjectFileNode) => Promise<{url: string; release(): void}>,
) {
  let generation = 0;
  let release: (() => void) | undefined;
  const finish = () => {
    generation++;
    module.wait_video = false;
    video.pause();
    video.hidden = true;
    canvas.hidden = false;
    video.removeAttribute("src");
    release?.(); release = undefined;
  };
  video.addEventListener("ended", finish);
  video.addEventListener("error", finish);
  host.playVideo = (path: string, click: boolean, loop: boolean) => {
    finish();
    const node = fileMap[path.toLowerCase()];
    if (!node) {return;}
    module.wait_video = true;
    video.loop = loop;
    video.onclick = click ? finish : null;
    video.hidden = false;
    canvas.hidden = true;
    const current = generation;
    if (source) {
      void source(node).then(result => {
        if (current !== generation) {result.release(); return;}
        release = result.release; video.src = result.url; void video.play().catch(finish);
      }).catch(() => {if (current === generation) {finish();}});
    } else {video.src = node.url; void video.play().catch(finish);}
  };
  return () => {
    video.removeEventListener("ended", finish);
    video.removeEventListener("error", finish);
    video.onclick = null;
    finish();
  };
}

function runtimeArgs(config: OnsParameters, index: ProjectIndex) {
  return [
    "--root", gameRoot,
    "--font", `${gameRoot}/${fontPath(index)}`,
    "--save-dir", saveRoot,
    `--enc:${config.scriptEncoding}`,
  ];
}

async function readRestore(payload: Uint8Array | null) {
  if (!payload) {return null;}
  try {
    return await decodeOnsCheckpoint(payload);
  } catch {throw new Error("ONS_CHECKPOINT_RESTORE_FAILED");}
}

async function checkpointDigest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", bytes.slice());
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function canvasScreenshot(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob?.size ? resolve(blob) : reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE")), "image/png");
  });
}

function retainDisplayedWebGLFrame(canvas: HTMLCanvasElement) {
  const getContext = canvas.getContext;
  Object.defineProperty(canvas, "getContext", {
    configurable: true,
    value(contextId: string, options?: unknown) {
      const webGL = contextId === "webgl" || contextId === "webgl2" || contextId === "experimental-webgl";
      const attributes = options && typeof options === "object" ? options : {};
      return Reflect.apply(getContext, canvas, [
        contextId,
        webGL ? { ...attributes, preserveDrawingBuffer: true } : options,
      ]);
    },
  });
}

function stopEngine(module: OnsModule) {
  try {module._onsyuri_host_stop();}
  catch (error) {
    // Emscripten's forced clean exit unwinds the JS boundary with ExitStatus.
    if (!error || typeof error !== "object" || Reflect.get(error, "name") !== "ExitStatus" || Reflect.get(error, "status") !== 0) {throw error;}
  }
}

function loadRuntimeScript(document: Document, url: string) {
  return new Promise<HTMLScriptElement>((resolve, reject) => {
    const script = document.createElement("script");
    script.dataset.runtime = "ons-yuri";
    script.src = url;
    script.onload = () => resolve(script);
    script.onerror = () => {script.remove(); reject(new Error("ONS_RUNTIME_ARTIFACT_UNAVAILABLE"));};
    document.head.append(script);
  });
}

function captureGlobals(host: OnsHostWindow) {
  const names = ["flush_save", "g_onsyuri_content", "g_onsyuri_module",
    "onsyuriHostReady", "playVideo", "scale_full"] as const;
  return new Map(names.map((name) => [name, host[name]]));
}

function restoreGlobals(host: OnsHostWindow, values: Map<string, unknown>) {
  for (const [name, value] of values) {
    if (value === undefined) {delete host[name];} else {host[name] = value;}
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {resolve = accept; reject = decline;});
  return { promise, reject, resolve };
}

function normalizedBase(value: string) {return value.endsWith("/") ? value : `${value}/`;}
function scaleToFrame(frameWindow: Window, element: HTMLElement, ratio: number) {
  const bounds = element.parentElement?.getBoundingClientRect();
  const width = bounds?.width || frameWindow.innerWidth;
  const height = bounds?.height || frameWindow.innerHeight;
  const fitWidth = ratio <= 0 || width / height <= ratio;
  element.style.width = `${fitWidth ? width : height * ratio}px`;
  element.style.height = `${fitWidth && ratio > 0 ? width / ratio : height}px`;
  return { h: element.style.height, w: element.style.width };
}
function parentPath(value: string) {return value.slice(0, value.lastIndexOf("/")) || "/";}

function fontPath(index: ProjectIndex) {
  const font = index.files.find(file => file.path.toLowerCase() === "default.ttf");
  if (!font) {throw new Error("ONS_PROJECT_FONT_MISSING");}
  return font.path;
}
