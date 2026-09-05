import { decodeRpgCheckpoint, encodeRpgCheckpoint } from "../checkpoint.js";
import type { MountedRuntimeAdapter, RuntimeExitReporter } from "../internal-adapter.js";
import {
  rpgMakerPositionProbeKind,
  type RpgMakerPositionV1,
  type RpgMakerRuntimeConfig,
} from "../rpgmaker/contract.js";

type EasyConfig = RpgMakerRuntimeConfig & {
  adapter: Extract<RpgMakerRuntimeConfig["adapter"], { adapterKind: "EASYRPG_WEB" }>;
};

type EasyFileSystem = {
  analyzePath(path: string): { exists: boolean };
  readFile(path: string): Uint8Array;
};

type EasyState = RpgMakerPositionV1 & {
  engine: "RPG2000" | "RPG2003";
  ready: boolean;
  canCheckpoint: boolean;
  frameCount: number;
};

type EasyModule = {
  FS: EasyFileSystem;
  api: {
    createRuntimeCheckpoint(): boolean;
    runtimeState(): string;
  };
  canvas: HTMLCanvasElement;
  runtimeFileSystemReady?: boolean;
  initApi(): void;
  pauseMainLoop(): void;
  resumeMainLoop(): void;
};

type EasyModuleOptions = {
  game: string;
  noExitRuntime: true;
  onRuntimeExitRequested(): void;
  saveFs: undefined;
  locateFile(path: string): string;
  runtimeEngineMode: string;
  runtimeProjectRootUrl: string;
  runtimeRtpRemoteFiles: Array<{ lookupPath: string; path: string; url: string }>;
  runtimeRestoreSlot?: number;
  runtimeRestoreFiles: Array<{ path: string; bytes: Uint8Array }>;
};

type EasyWindow = Window & {
  createEasyRpgPlayer?: (options: EasyModuleOptions) => Promise<EasyModule>;
};

type RuntimeFileTreeIndex = {
  files: Array<{ path: string; sizeBytes: number; url: string }>;
  schemaVersion: 1;
};

const maximumRtpFiles = 20_000;
const savePath = "Save/Save100.lsd";

export async function mountEasyRpg(
  config: EasyConfig,
  target: HTMLElement,
  frameWindow: Window,
  restorePayload: Uint8Array | null,
  reportExitRequested: RuntimeExitReporter = () => undefined,
) {
  try {return await mountEasyRpgUnchecked(config, target, frameWindow, restorePayload, reportExitRequested);}
  catch (error) {
    target.replaceChildren();
    frameWindow.document.querySelectorAll("script[data-rpg-runtime]").forEach((script) => script.remove());
    throw error;
  }
}

async function mountEasyRpgUnchecked(
  config: EasyConfig,
  target: HTMLElement,
  frameWindow: Window,
  restorePayload: Uint8Array | null,
  reportExitRequested: RuntimeExitReporter,
) {
  const runtimeWindow = frameWindow as EasyWindow;
  const document = frameWindow.document;
  const canvas = document.createElement("canvas");
  canvas.id = "canvas";
  canvas.tabIndex = 0;
  retainDisplayedWebGLFrame(canvas);
  const status = document.createElement("div");
  status.id = "status";
  target.append(canvas, status);

  const [rtpFiles, restoreFiles] = await Promise.all([
    loadRtp(config),
    decodeRestore(config, restorePayload),
  ]);
  const script = await loadScript(document, `${config.adapter.runtimeBaseUrl}easyrpg-player.js`);
  const createPlayer = runtimeWindow.createEasyRpgPlayer;
  if (typeof createPlayer !== "function") {
    script.remove();
    throw new Error("RPG_RUNTIME_ARTIFACT_INVALID");
  }
  const playerModule = await createPlayer({
    game: config.sessionId,
    noExitRuntime: true,
    onRuntimeExitRequested: () => reportExitRequested(),
    saveFs: undefined,
    locateFile: (path) => `${config.adapter.runtimeBaseUrl}${path}`,
    runtimeEngineMode: config.adapter.engineMode,
    runtimeProjectRootUrl: config.adapter.projectRootUrl,
    runtimeRtpRemoteFiles: rtpFiles,
    ...(restoreFiles.length ? { runtimeRestoreSlot: config.adapter.checkpointSlot } : {}),
    runtimeRestoreFiles: restoreFiles,
  });
  playerModule.initApi();
  const expectedEngine = config.generation === "RPG2000" ? "RPG2000" : "RPG2003";
  await waitForReady(playerModule, expectedEngine);

  return {
    checkpoint: async () => {
      if (!playerModule.api.createRuntimeCheckpoint()) {throw new Error("RPG_CHECKPOINT_UNAVAILABLE");}
      const bytes = readCheckpoint(playerModule.FS);
      return {
        bytes: await encodeRpgCheckpoint({
          engine: expectedEngine,
          resumeSlot: config.adapter.checkpointSlot,
          entries: [{ store: "FILESYSTEM", key: savePath, mediaType: "application/octet-stream", data: bytes }],
        }),
        format: "easyrpg-save-bundle-v1",
      };
    },
    exit: async () => {
      playerModule.pauseMainLoop();
      script.remove();
      target.replaceChildren();
    },
    getCanvas: () => playerModule.canvas,
    getCheckpointAvailability: () => readState(playerModule).canCheckpoint
      ? { available: true, blocker: null }
      : { available: false, blocker: "BUSY" },
    getFrameCount: () => readState(playerModule).frameCount,
    getValidationProbe: (kind) => {
      const state = readState(playerModule);
      return kind === rpgMakerPositionProbeKind && state.ready
        ? { kind, schemaVersion: 1, value: position(state) }
        : null;
    },
    pause: async () => {playerModule.pauseMainLoop();},
    resume: async () => {playerModule.resumeMainLoop();},
    screenshot: () => canvasBlob(playerModule.canvas),
    setVolume: null,
  } satisfies MountedRuntimeAdapter;
}

function readState(module: EasyModule): EasyState {
  let parsed: unknown;
  try {parsed = JSON.parse(module.api.runtimeState());}
  catch {throw new Error("RPG_RUNTIME_POSITION_UNAVAILABLE");}
  if (!parsed || typeof parsed !== "object") {throw new Error("RPG_RUNTIME_POSITION_UNAVAILABLE");}
  const state = parsed as Partial<EasyState>;
  if ((state.engine !== "RPG2000" && state.engine !== "RPG2003") || typeof state.ready !== "boolean" ||
    typeof state.canCheckpoint !== "boolean" || !validInteger(state.frameCount, 0) || !validPosition(state)) {
    throw new Error("RPG_RUNTIME_POSITION_UNAVAILABLE");
  }
  return state as EasyState;
}

function validPosition(value: Partial<RpgMakerPositionV1>) {
  return validInteger(value.mapId, 0) && validInteger(value.playerX) && validInteger(value.playerY) &&
    validInteger(value.fixtureState);
}

function validInteger(value: unknown, minimum = -2_147_483_648) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= 2_147_483_647;
}

function position(state: EasyState): RpgMakerPositionV1 {
  return { mapId: state.mapId, playerX: state.playerX, playerY: state.playerY, fixtureState: state.fixtureState };
}

async function waitForReady(
  module: EasyModule,
  expectedEngine: EasyState["engine"],
) {
  if (module.runtimeFileSystemReady !== true) {
    throw new Error("RPG_RUNTIME_FILESYSTEM_NOT_READY");
  }
  const deadline = performance.now() + 30_000;
  let engineMismatch = false;
  while (performance.now() < deadline) {
    const state = startupState(module);
    if (state && (state.ready || state.frameCount > 0)) {
      engineMismatch = state.engine !== expectedEngine;
      if (!engineMismatch) {return;}
      if (state.ready) {throw new Error("RPG_ENGINE_PROFILE_MISMATCH");}
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error(engineMismatch ? "RPG_ENGINE_PROFILE_MISMATCH" : "RPG_RUNTIME_TIMEOUT");
}

function startupState(module: EasyModule) {
  try {return readState(module);}
  catch (error) {
    if (error instanceof Error && error.message === "RPG_RUNTIME_POSITION_UNAVAILABLE") {return null;}
    throw error;
  }
}

async function decodeRestore(config: EasyConfig, payload: Uint8Array | null) {
  if (!payload) {return [];}
  const expectedEngine = config.generation === "RPG2000" ? "RPG2000" : "RPG2003";
  const bundle = await decodeRpgCheckpoint(payload, expectedEngine);
  if (bundle.resumeSlot !== config.adapter.checkpointSlot || bundle.entries.length !== 1) {
    throw new Error("RPG_CHECKPOINT_RESTORE_INVALID");
  }
  const entry = bundle.entries[0];
  if (entry.store !== "FILESYSTEM" || entry.key !== savePath) {throw new Error("RPG_CHECKPOINT_RESTORE_INVALID");}
  return [{ path: entry.key, bytes: entry.data }];
}

function readCheckpoint(fileSystem: EasyFileSystem) {
  const candidates = [savePath, `/${savePath}`];
  for (const candidate of candidates) {
    if (!fileSystem.analyzePath(candidate).exists) {continue;}
    const value = fileSystem.readFile(candidate);
    if (value.byteLength) {return new Uint8Array(value).slice();}
  }
  throw new Error("RPG_CHECKPOINT_CREATE_FAILED");
}

async function loadRtp(config: EasyConfig) {
  const source = config.adapter.rtpSource;
  if (!source) {return [];}
  const index = await fetchRtpIndex(source.indexUrl);
  const base = new URL(source.indexUrl, window.location.href);
  const seen = new Set<string>();
  return index.files.map((file) => {
    const lookupPath = easyRpgLookupPath(file.path);
    if (seen.has(lookupPath)) {throw new Error("RPG_RUNTIME_PACK_INVALID");}
    seen.add(lookupPath);
    return { lookupPath, path: file.path, url: new URL(file.url, base).href };
  });
}

async function fetchRtpIndex(url: string): Promise<RuntimeFileTreeIndex> {
  let value: unknown;
  try {
    const response = await fetch(url, { credentials: "same-origin", cache: "default", redirect: "error" });
    if (!response.ok || response.url !== new URL(url, window.location.href).href) {throw new Error("response");}
    value = await response.json();
  } catch {throw new Error("RPG_RUNTIME_PACK_UNAVAILABLE");}
  if (!validRtpIndex(value)) {throw new Error("RPG_RUNTIME_PACK_INVALID");}
  return value;
}

function validRtpIndex(value: unknown): value is RuntimeFileTreeIndex {
  if (!isRecord(value) || !exactKeys(value, ["files", "schemaVersion"]) || value.schemaVersion !== 1 ||
    !Array.isArray(value.files) || value.files.length < 1 || value.files.length > maximumRtpFiles) {return false;}
  const paths = new Set<string>();
  for (const file of value.files) {
    if (!isRecord(file) || !exactKeys(file, ["path", "sizeBytes", "url"]) || !safePath(file.path) ||
      !validUrl(file.url) || !Number.isSafeInteger(file.sizeBytes) || Number(file.sizeBytes) < 1) {return false;}
    const identity = file.path.normalize("NFKC").toLowerCase();
    if (paths.has(identity)) {return false;}
    paths.add(identity);
  }
  return true;
}

function easyRpgLookupPath(path: string) {
  const segments = path.split("/").map((part) => part.normalize("NFKC").toLowerCase());
  const filename = segments.at(-1) ?? "";
  const extension = filename.lastIndexOf(".");
  const stem = extension > 0 ? filename.slice(0, extension) : filename;
  if (segments.length === 1) {
    segments[0] = stem === "exfont" ? stem : filename;
  } else if (!filename.endsWith(".ini") && !filename.endsWith(".po")) {
    segments[segments.length - 1] = stem;
  }
  return segments.join("/");
}

function safePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.startsWith("/") &&
    !value.includes("\\") && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function validUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) {return false;}
  try {
    const parsed = new URL(value, window.location.href);
    return parsed.origin === window.location.origin && (parsed.protocol === "http:" || parsed.protocol === "https:");
  } catch {return false;}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function loadScript(document: Document, url: string) {
  return new Promise<HTMLScriptElement>((resolve, reject) => {
    const script = document.createElement("script");
    script.dataset.rpgRuntime = "easyrpg";
    script.src = url;
    script.async = true;
    script.addEventListener("load", () => resolve(script), { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("RPG_RUNTIME_ARTIFACT_UNAVAILABLE"));
    }, { once: true });
    document.head.append(script);
  });
}

async function canvasBlob(canvas: HTMLCanvasElement) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const blob = await encodeCanvas(canvas);
    if (await visibleEncodedFrame(canvas, blob)) {return blob;}
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");
}

function encodeCanvas(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob?.size) {resolve(blob);} else {reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE"));}
  }, "image/png"));
}

async function visibleEncodedFrame(canvas: HTMLCanvasElement, blob: Blob) {
  const frameWindow = canvas.ownerDocument.defaultView;
  if (!frameWindow?.createImageBitmap) {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
  const bitmap = await frameWindow.createImageBitmap(blob);
  const width = Math.min(bitmap.width, 160);
  const height = Math.min(bitmap.height, Math.max(1, Math.round(bitmap.height * width / bitmap.width)));
  const probe = canvas.ownerDocument.createElement("canvas");
  probe.width = width;
  probe.height = height;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) {bitmap.close(); throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  let visible = 0;
  const minimum = Math.max(16, Math.floor(width * height / 200));
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) >= 16) {
      visible += 1;
      if (visible >= minimum) {return true;}
    }
  }
  return false;
}

function retainDisplayedWebGLFrame(canvas: HTMLCanvasElement) {
  const getContext = canvas.getContext;
  Object.defineProperty(canvas, "getContext", {
    configurable: true,
    value(contextId: string, options?: unknown) {
      const webGL = contextId === "webgl" || contextId === "webgl2" || contextId === "experimental-webgl";
      const attributes = options && typeof options === "object" ? options : {};
      const effectiveOptions = webGL ? { ...attributes, preserveDrawingBuffer: true } : options;
      return Reflect.apply(getContext, canvas, [contextId, effectiveOptions]);
    },
  });
}
