import { unzip } from "fflate";
import { decodeRpgCheckpoint, encodeRpgCheckpoint } from "../checkpoint.js";
import type { MountedRuntimeAdapter } from "../internal-adapter.js";
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
  saveFs: undefined;
  locateFile(path: string): string;
  runtimeEngineMode: string;
  runtimeProjectRootUrl: string;
  runtimeRtpMountPath?: string;
  runtimeRtpFiles: Array<{ path: string; bytes: Uint8Array }>;
  runtimeRestoreSlot?: number;
  runtimeRestoreFiles: Array<{ path: string; bytes: Uint8Array }>;
};

type EasyWindow = Window & {
  createEasyRpgPlayer?: (options: EasyModuleOptions) => Promise<EasyModule>;
};

const maximumArchiveBytes = 512 * 1024 * 1024;
const savePath = "Save/Save100.lsd";

export async function mountEasyRpg(
  config: EasyConfig,
  target: HTMLElement,
  frameWindow: Window,
  restorePayload: Uint8Array | null,
) {
  try {return await mountEasyRpgUnchecked(config, target, frameWindow, restorePayload);}
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
    saveFs: undefined,
    locateFile: (path) => `${config.adapter.runtimeBaseUrl}${path}`,
    runtimeEngineMode: config.adapter.engineMode,
    runtimeProjectRootUrl: config.adapter.projectRootUrl,
    ...(config.adapter.rtpArchive ? { runtimeRtpMountPath: config.adapter.rtpArchive.mountPath } : {}),
    runtimeRtpFiles: rtpFiles,
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
    getValidationProbe: (kind) => kind === rpgMakerPositionProbeKind
      ? { kind, schemaVersion: 1, value: position(readState(playerModule)) }
      : null,
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
  while (performance.now() < deadline) {
    const state = startupState(module);
    if (state?.ready) {
      if (state.engine !== expectedEngine) {throw new Error("RPG_ENGINE_PROFILE_MISMATCH");}
      return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error("RPG_RUNTIME_TIMEOUT");
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
  const archive = config.adapter.rtpArchive;
  if (!archive) {return [];}
  const bytes = await fetchBytes(archive.url, maximumArchiveBytes);
  if (await digest(bytes) !== archive.sha256) {throw new Error("RPG_RUNTIME_PACK_DIGEST_MISMATCH");}
  const files = await unzipBytes(bytes);
  let total = 0;
  const result: Array<{ path: string; bytes: Uint8Array }> = [];
  const names = Object.keys(files).sort();
  if (names.length > 10_000) {throw new Error("RPG_RUNTIME_PACK_INVALID");}
  for (const name of names) {
    if (!safeArchivePath(name) || name.endsWith("/")) {continue;}
    const contents = files[name];
    total += contents.byteLength;
    if (total > maximumArchiveBytes) {throw new Error("RPG_RUNTIME_PACK_INVALID");}
    result.push({ path: `${archive.mountPath}/${name}`, bytes: contents });
  }
  if (!result.length) {throw new Error("RPG_RUNTIME_PACK_INVALID");}
  return result;
}

function safeArchivePath(value: string) {
  return Boolean(value) && value.length <= 512 && !value.startsWith("/") && !value.includes("\\") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function unzipBytes(bytes: Uint8Array) {
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (error, files) => error ? reject(new Error("RPG_RUNTIME_PACK_INVALID")) : resolve(files));
  });
}

async function fetchBytes(url: string, maximum: number) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", redirect: "error" });
  if (!response.ok || response.url !== new URL(url, window.location.href).href) {throw new Error("RPG_RUNTIME_CONTENT_UNAVAILABLE");}
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > maximum) {throw new Error("RPG_RUNTIME_CONTENT_UNAVAILABLE");}
  return bytes;
}

async function digest(bytes: Uint8Array) {
  const value = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer));
  return [...value].map((item) => item.toString(16).padStart(2, "0")).join("");
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
