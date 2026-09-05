import { decodeOnsCheckpoint, encodeOnsCheckpoint, type OnsCheckpointBundle } from "./checkpoint.js";
import type { MountedRuntimeAdapter, RuntimeExitReporter, RuntimeProgressReporter } from "../internal-adapter.js";
import type {OnsParameters} from "./parameters.js";
import { installOnsAnalogGamepad } from "./gamepad-input.js";
import {
  createOnsProjectFileMap,
  type OnsProjectFile,
  type OnsProjectFileNode,
} from "./project-files.js";

type ProjectIndex = { schemaVersion: 1; title: string; fontPath: string; files: OnsProjectFile[] };

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
  _onsyuri_host_load(slot: number): number;
  _onsyuri_host_did_restore_fail(): number;
  _onsyuri_host_is_ready(): number;
  _onsyuri_host_save(slot: number): number;
  _onsyuri_host_set_paused(paused: number): void;
  _onsyuri_host_set_restore_slot(slot: number): void;
};

type OnsFactory = (options: Partial<OnsModule>) => Promise<OnsModule>;
type OnsHostWindow = Window & Record<string, unknown> & {
  onsyuri?: OnsFactory;
  onsyuriHostReady?: () => void;
};

const gameRoot = "/game";
const saveRoot = "/save";
const maximumCheckpointBytes = 64 * 1024 * 1024;
const maximumProjectFiles = 100_000;
const readyTimeoutMs = 30_000;

export async function mountOnsYuri(
  config: OnsParameters,
  target: HTMLElement,
  frameWindow: Window,
  restorePayload: Uint8Array | null,
  reportProgress: RuntimeProgressReporter = () => undefined,
  reportExitRequested: RuntimeExitReporter = () => undefined,
): Promise<MountedRuntimeAdapter> {
  if (target.ownerDocument !== frameWindow.document) {throw new Error("ONS_RUNTIME_TARGET_INVALID");}
  reportProgress({ phase: "PROJECT_INDEX", loadedBytes: 0, totalBytes: null });
  const index = await loadProjectIndex(config.projectIndexUrl);
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
  canvas.setAttribute("aria-label", index.title);
  video.hidden = true;
  surface.append(canvas, video);
  target.replaceChildren(surface);
  const focusCanvas = () => {
    canvas.focus({ preventScroll: true });
  };
  canvas.addEventListener("pointerdown", focusCanvas, true);
  const gamepadCleanup = installOnsAnalogGamepad(frameWindow, canvas);

  const globals = captureGlobals(host);
  const projectFiles = createOnsProjectFileMap(index.files, frameWindow, reportProgress);
  const fileMap = projectFiles.fileMap;
  let module: OnsModule | null = null;
  let paused = false;
  let exited = false;
  let videoCleanup: () => void = () => undefined;
  const ready = deferred<void>();
  const base = new URL(normalizedBase(config.runtimeBaseUrl), document.baseURI).href;
  const moduleOptions: Partial<OnsModule> = {
    canvas,
    locateFile: (path) => new URL(path, base).href,
    onExit: () => reportExitRequested(),
    onAbort: () => ready.reject(new Error("ONS_RUNTIME_ABORTED")),
    preRun: () => {
      const current = host.g_onsyuri_module as OnsModule | undefined;
      if (!current?.FS) {throw new Error("ONS_RUNTIME_FILESYSTEM_UNAVAILABLE");}
      prepareFileSystem(current.FS, index.files, restore);
    },
    printErr: (message) => {if (message) {console.debug(`[ons-yuri] ${message}`);}},
  };
  host.g_onsyuri_module = moduleOptions;
  host.g_onsyuri_index = { gamedir: gameRoot, savedir: saveRoot };
  host.g_onsyuri_filemap = fileMap;
  host.fetch_file = projectFiles.fetchFile;
  host.flush_save = () => undefined;
  host.onsyuriHostReady = () => ready.resolve();
  host.scale_full = (element: HTMLElement, ratio = 0) => scaleToFrame(frameWindow, element, ratio);

  let script: HTMLScriptElement | null = null;
  try {
    script = await loadRuntimeScript(document, new URL("onsyuri.js", base).href);
    if (typeof host.onsyuri !== "function") {throw new Error("ONS_RUNTIME_ARTIFACT_INVALID");}
    module = await host.onsyuri(moduleOptions);
    host.g_onsyuri_module = module;
    videoCleanup = installVideo(host, module, video, canvas, fileMap);
    module._onsyuri_host_set_restore_slot(restore?.resumeSlot ?? -1);
    const started = module.callMain(runtimeArgs(config, index));
    if (started instanceof Promise) {void started.catch(() => ready.reject(new Error("ONS_RUNTIME_START_FAILED")));}
    await withTimeout(waitForEngine(ready.promise, module), readyTimeoutMs, "ONS_RUNTIME_TIMEOUT");
    focusCanvas();
  } catch (error) {
    module?._onsyuri_host_set_paused(1);
    videoCleanup();
    gamepadCleanup();
    script?.remove();
    canvas.removeEventListener("pointerdown", focusCanvas, true);
    target.replaceChildren();
    restoreGlobals(host, globals);
    throw error;
  }

  const activeModule = module;
  return {
    checkpoint: async () => {
      if (exited) {throw new Error("ONS_RUNTIME_INVALID_STATE");}
      const resume = !paused;
      if (resume) {activeModule._onsyuri_host_set_paused(1);}
      try {
        if (activeModule._onsyuri_host_save(config.checkpointSlot) !== 0) {
          throw new Error("ONS_CHECKPOINT_CREATE_FAILED");
        }
        const entries = collectFiles(activeModule.FS, saveRoot);
        if (!entries.some((entry) => entry.path === `save${config.checkpointSlot}.dat`)) {
          throw new Error("ONS_CHECKPOINT_CREATE_FAILED");
        }
        return {
          bytes: await encodeOnsCheckpoint({ entries, resumeSlot: config.checkpointSlot }),
          format: "ons-save-bundle-v1",
        };
      } catch (error) {
        if (error instanceof Error && error.message === "ONS_CHECKPOINT_CREATE_FAILED") {throw error;}
        throw new Error("ONS_CHECKPOINT_CREATE_FAILED");
      } finally {
        if (resume) {activeModule._onsyuri_host_set_paused(0);}
      }
    },
    exit: async () => {
      if (exited) {return;}
      exited = true;
      activeModule._onsyuri_host_set_paused(1);
      videoCleanup();
      gamepadCleanup();
      script?.remove();
      canvas.removeEventListener("pointerdown", focusCanvas, true);
      target.replaceChildren();
      restoreGlobals(host, globals);
    },
    getCanvas: () => canvas,
    getCheckpointAvailability: () => ({ available: true, blocker: null }),
    getFrameCount: () => null,
    getValidationProbe: () => null,
    pause: async () => {activeModule._onsyuri_host_set_paused(1); paused = true;},
    resume: async () => {activeModule._onsyuri_host_set_paused(0); paused = false;},
    screenshot: () => canvasScreenshot(canvas),
    setVolume: null,
  };
}

async function loadProjectIndex(url: string): Promise<ProjectIndex> {
  let value: unknown;
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {throw new Error("response");}
    value = await response.json();
  } catch {throw new Error("ONS_PROJECT_INDEX_UNAVAILABLE");}
  if (!validIndex(value)) {throw new Error("ONS_PROJECT_INDEX_INVALID");}
  return value;
}

function validIndex(value: unknown): value is ProjectIndex {
  if (!isRecord(value) || !exactKeys(value, ["files", "fontPath", "schemaVersion", "title"]) ||
    value.schemaVersion !== 1 || !boundedText(value.title, 500) || !validPath(value.fontPath) ||
    !Array.isArray(value.files) || value.files.length < 2 || value.files.length > maximumProjectFiles) {return false;}
  const seen = new Set<string>();
  let fontFound = false;
  let totalBytes = 0;
  for (const item of value.files) {
    if (!validProjectFile(item)) {return false;}
    const identity = item.path.toLowerCase();
    if (seen.has(identity)) {return false;}
    seen.add(identity);
    totalBytes += Number(item.sizeBytes);
    if (!Number.isSafeInteger(totalBytes)) {return false;}
    fontFound ||= item.path === value.fontPath;
  }
  return fontFound;
}

function validProjectFile(value: unknown): value is OnsProjectFile {
  return isRecord(value) && exactKeys(value, ["path", "sizeBytes", "url"]) && validPath(value.path) &&
    validProjectUrl(value.url) && Number.isSafeInteger(value.sizeBytes) && Number(value.sizeBytes) >= 1;
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
) {
  const finish = () => {
    module.wait_video = false;
    video.pause();
    video.hidden = true;
    canvas.hidden = false;
    video.removeAttribute("src");
  };
  video.addEventListener("ended", finish);
  video.addEventListener("error", finish);
  host.playVideo = (path: string, click: boolean, loop: boolean) => {
    finish();
    const node = fileMap[path.toLowerCase()];
    if (!node) {return;}
    module.wait_video = true;
    video.src = node.url;
    video.loop = loop;
    video.onclick = click ? finish : null;
    video.hidden = false;
    canvas.hidden = true;
    void video.play().catch(finish);
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
    "--font", `${gameRoot}/${index.fontPath}`,
    "--save-dir", saveRoot,
    `--enc:${config.scriptEncoding}`,
  ];
}

async function readRestore(payload: Uint8Array | null) {
  if (!payload) {return null;}
  try {
    const restore = await decodeOnsCheckpoint(payload);
    if (!restore.entries.some((entry) => entry.path === `save${restore.resumeSlot}.dat`)) {
      throw new Error("missing slot");
    }
    return restore;
  } catch {throw new Error("ONS_CHECKPOINT_RESTORE_FAILED");}
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

async function waitForEngine(signal: Promise<void>, module: OnsModule) {
  await signal;
  while (module._onsyuri_host_is_ready() !== 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (module._onsyuri_host_did_restore_fail() === 1) {
    throw new Error("ONS_CHECKPOINT_RESTORE_FAILED");
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
  const names = ["fetch_file", "flush_save", "g_onsyuri_filemap", "g_onsyuri_index", "g_onsyuri_module",
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(code)), timeoutMs);
    promise.then((value) => {window.clearTimeout(timer); resolve(value);},
      (error) => {window.clearTimeout(timer); reject(error);});
  });
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
function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}
function validProjectUrl(value: unknown) {
  if (typeof value !== "string") {return false;}
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes("#")) {return true;}
  try {return ["http:", "https:"].includes(new URL(value).protocol);} catch {return false;}
}
function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && value.normalize("NFC") === value &&
    !value.startsWith("/") && !value.includes("\\") && !value.includes("//") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
