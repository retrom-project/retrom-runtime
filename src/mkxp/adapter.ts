import { Nostalgist } from "nostalgist";
import type { MountedRuntimeAdapter, RuntimeExitReporter, RuntimeProgressReporter } from "../internal-adapter.js";
import {
  rpgMakerPositionProbeKind,
  type RpgMakerPositionV1,
} from "../rpgmaker/contract.js";
import {
  decodeMkxpCheckpoint,
  decodeMkxpRastate,
  encodeMkxpCheckpoint,
  encodeMkxpRastate,
  mkxpRastateEnvelopeBytes,
} from "./state.js";

import type {MkxpParameters} from "./parameters.js";

type MkxpFileSystem = {
  analyzePath(path: string): { exists: boolean };
  mkdirTree(path: string): void;
  readdir(path: string): string[];
  readFile(path: string): Uint8Array;
  rename(from: string, to: string): void;
  stat(path: string): { size: number };
  unlink(path: string): void;
  writeFile(path: string, contents: Uint8Array): void;
};

type MkxpRuntime = Pick<Nostalgist,
  "exit" | "getEmscriptenFS" | "start"
>;

type MkxpPrepareOptions = Parameters<typeof Nostalgist.prepare>[0] & {
  emscriptenModule: NonNullable<Parameters<typeof Nostalgist.prepare>[0]["emscriptenModule"]> & {
    onExit: (status: number) => void;
    preRun: Array<(module: { ENV: Record<string, string> }) => void>;
  };
};

type MkxpMountDependencies = {
  decodeCheckpoint: typeof decodeMkxpCheckpoint;
  encodeCheckpoint: typeof encodeMkxpCheckpoint;
  fetchVerified: (url: string, expectedSize: number, expectedDigest: string) => Promise<Uint8Array>;
  prepare: (options: MkxpPrepareOptions) => Promise<MkxpRuntime>;
};

const positionBridge = { size: 1504, sha256: "097dac75b3394cae471ea1a21af65d64035bb87a9d1d8781d555446693c200c2" };
const systemRoot = "/home/web_user/retroarch/userdata/system";
const saveRoot = "/home/web_user/retroarch/userdata/saves";
const stateRoot = "/home/web_user/retroarch/userdata/states";
const coreStateRoot = `${stateRoot}/mkxp-z`;
const statePath = `${coreStateRoot}/game.state`;
const bridgePath = `${systemRoot}/mkxp-z/Scripts/Preload/position_bridge.rb`;
const evidenceName = "rpg-runtime-position";
const bridgeOption = "mkxp-z_preload-706f736974696f6e5f6272696467652e7262";
const remoteGamePath = "/retrom-content/game.mkxpz";
const fetchManifestPath = `${systemRoot}/mkxp-z/fetch.manifest`;
const fetchBaseDirectory = "/retrom-fetch";
const fetchChunkSizeBytes = 256 * 1024;
const saveStateHotkey = { code: "F2", keyCode: 113 } as const;
const loadStateHotkey = { code: "F4", keyCode: 115 } as const;
const pauseToggleHotkey = { code: "F6", keyCode: 117 } as const;
const browserDependencies: MkxpMountDependencies = {
  decodeCheckpoint: decodeMkxpCheckpoint,
  encodeCheckpoint: encodeMkxpCheckpoint,
  fetchVerified,
  prepare: (options) => Nostalgist.prepare(options),
};

function defaultMkxpDiagnostic(diagnostic: { runtime: string; message: string }) {
  // RetroArch writes its complete native log stream to stderr, including
  // routine INFO startup lines. Nostalgist maps stderr to console.error by
  // default, which makes Next's development overlay report every healthy log
  // line as an application issue. Fatal worker/runtime failures still surface
  // independently as rejected promises and page errors.
  window.dispatchEvent(new CustomEvent("rpg-runtime:diagnostic", { detail: diagnostic }));
}

export async function mountMkxp(
  config: MkxpParameters,
  target: HTMLElement,
  restorePayload: Uint8Array | null,
  dependencies: MkxpMountDependencies = browserDependencies,
  onDiagnostic: (diagnostic: { runtime: string; message: string }) => void = defaultMkxpDiagnostic,
  reportProgress: RuntimeProgressReporter = () => undefined,
  reportExitRequested: RuntimeExitReporter = () => undefined,
) {
  try {
    return await mountMkxpUnchecked(
      config, target, restorePayload, dependencies, onDiagnostic, reportProgress, reportExitRequested,
    );
  }
  catch (error) {
    onDiagnostic({ runtime: "mkxp-z", message: `RPG_RUNTIME_MOUNT_FAILED:${mountFailureMessage(error)}` });
    target.replaceChildren();
    throw error;
  }
}

function mountFailureMessage(error: unknown) {
  const value = error instanceof Error ? error.message : "unknown";
  return [...value].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }).join("").trim().slice(0, 600) || "unknown";
}

async function mountMkxpUnchecked(
  config: MkxpParameters,
  target: HTMLElement,
  restorePayload: Uint8Array | null,
  dependencies: MkxpMountDependencies,
  onDiagnostic: (diagnostic: { runtime: string; message: string }) => void,
  reportProgress: RuntimeProgressReporter,
  reportExitRequested: RuntimeExitReporter,
) {
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
    throw new Error("RPG_RUNTIME_THREADS_REQUIRED");
  }
  // Nostalgist validates the element against the HTMLCanvasElement constructor
  // in its own module realm. The Player target lives in a same-origin child
  // document, so creating the canvas through target.ownerDocument makes a
  // genuine canvas fail that cross-realm instanceof check. Create it in the
  // adapter realm and let append() adopt it into the Player frame.
  const canvas = document.createElement("canvas");
  // Nostalgist assigns this exact ID during prepare. Use it from the first DOM
  // insertion so the Player never exposes a transient selector identity.
  canvas.id = "canvas";
  canvas.tabIndex = 0;
  const dimensions = config.rgssVersion === 1 ? [640, 480] : [544, 416];
  [canvas.style.width, canvas.style.height] = dimensions.map((value) => `${value}px`);
  target.append(canvas);
  const runtimeAssetBytes = config.core.jsSizeBytes + config.core.wasmSizeBytes + positionBridge.size;
  reportProgress({ phase: "RUNTIME_ASSET", loadedBytes: 0, totalBytes: runtimeAssetBytes });
  const [jsBytes, wasmBytes, bridgeBytes] = await Promise.all([
    dependencies.fetchVerified(
      config.core.jsUrl, config.core.jsSizeBytes, config.core.jsSha256,
    ),
    dependencies.fetchVerified(
      config.core.wasmUrl, config.core.wasmSizeBytes, config.core.wasmSha256,
    ),
    dependencies.fetchVerified(`${config.runtimeBaseUrl}position_bridge.rb`, positionBridge.size, positionBridge.sha256),
  ]);
  reportProgress({ phase: "RUNTIME_ASSET", loadedBytes: runtimeAssetBytes, totalBytes: runtimeAssetBytes });
  const remoteContent = remoteContentManifest(config);
  reportProgress({ phase: "PROJECT_INDEX", loadedBytes: 0, totalBytes: remoteContent.manifest.byteLength });
  const printDiagnostic = (...args: unknown[]) => {
    onDiagnostic({ runtime: "mkxp-z", message: args.map(String).join(" ") });
  };
  const nostalgist = await dependencies.prepare({
    core: {
      name: "mkxp-z",
      js: new Blob([jsBytes.slice().buffer], { type: "text/javascript" }),
      wasm: new Blob([wasmBytes.slice().buffer], { type: "application/wasm" }),
    },
    element: canvas,
    emscriptenModule: {
      arguments: [remoteGamePath],
      onExit: (status) => {
        onDiagnostic({ runtime: "mkxp-z", message: `RPG_RUNTIME_CORE_EXIT:${status}` });
        reportExitRequested();
      },
      // Emscripten creates its ENV object after applying Module overrides and
      // overwrites a caller-provided Module.ENV. Populate the final object at
      // preRun instead, before RetroArch calls into the core and libc getenv().
      preRun: [(module) => {Object.assign(module.ENV, fetchEnvironment());}],
      print: printDiagnostic,
      printErr: printDiagnostic,
    },
    retroarchConfig: {
      savefile_directory: "/home/web_user/retroarch/userdata/saves",
      savestate_directory: "/home/web_user/retroarch/userdata/states",
      system_directory: systemRoot,
      input_menu_toggle: "nul",
      input_save_state: "f2",
      input_load_state: "f4",
      input_pause_toggle: "f6",
      // The validation fixture changes its state through RGSS Input::C. mkxp-z
      // maps that action to RetroPad A, so bind its browser key explicitly
      // instead of inheriting a RetroArch/Nostalgist default that may drift.
      input_player1_a: "x",
      // The host persists the exact raw core payload and validates an exact
      // RASTATE1 runtime envelope. RetroArch otherwise defaults to rzip for
      // savestates, which changes the file format and defers file visibility.
      savestate_file_compression: false,
      savestate_thumbnail_enable: false,
      log_verbosity: true,
    },
    retroarchCoreConfig: {
      "mkxp-z_rgssVersion": String(config.rgssVersion),
      "mkxp-z_saveStateSize": String(config.stateBufferBytes / (1024 * 1024)),
      [bridgeOption]: "enabled",
    },
  });
  const fileSystem = nostalgist.getEmscriptenFS() as MkxpFileSystem;
  try {
    installRuntimeFiles(fileSystem, bridgeBytes, remoteContent.manifest);
    if (restorePayload) {
      const rawState = await dependencies.decodeCheckpoint(restorePayload, config.stateBufferBytes);
      installRestoreState(fileSystem, rawState, config.stateBufferBytes);
    }
    await nostalgist.start();
    reportProgress({
      phase: "PROJECT_INDEX",
      loadedBytes: remoteContent.manifest.byteLength,
      totalBytes: remoteContent.manifest.byteLength,
    });
    reportProgress({ phase: "PROJECT_CONTENT", loadedBytes: 0, totalBytes: remoteContent.totalBytes });
  } catch (error) {
    await nostalgist.exit();
    throw error;
  }
  try {
    await prepareEvidencePath(fileSystem, onDiagnostic);
    if (restorePayload) {
      await restoreStateAndWait(canvas, fileSystem, expectedRestorePosition(config));
    }
  } catch (error) {
    await nostalgist.exit();
    throw error;
  }
  return {
    checkpoint: async () => ({
      bytes: await saveStateBytes(canvas, fileSystem, config.stateBufferBytes, dependencies.encodeCheckpoint),
      format: "mkxp-state-compact-v1",
    }),
    exit: async () => {
      await nostalgist.exit();
      target.replaceChildren();
    },
    getCanvas: () => canvas,
    getCheckpointAvailability: () => ({ available: true, blocker: null }),
    getFrameCount: () => readCurrentPosition(fileSystem).frameCount,
    getValidationProbe: (kind) => kind === rpgMakerPositionProbeKind
      ? { kind, schemaVersion: 1, value: readCurrentPosition(fileSystem).position }
      : null,
    pause: async () => {await pressPrivateHotkey(canvas, pauseToggleHotkey);},
    resume: async () => {await pressPrivateHotkey(canvas, pauseToggleHotkey);},
    // Nostalgist's screenshot command calls RetroArch's exported GL function
    // from the browser main thread. The mkxp core owns its WebGL context on a
    // pthread, so that call has no GLctx and crashes in useProgram. Capturing
    // the displayed canvas stays on the browser side of that thread boundary.
    screenshot: () => canvasBlob(canvas),
    setVolume: null,
  } satisfies MountedRuntimeAdapter;
}

function installRuntimeFiles(
  fileSystem: MkxpFileSystem,
  bridgeBytes: Uint8Array,
  fetchManifest: Uint8Array,
) {
  fileSystem.mkdirTree(`${systemRoot}/mkxp-z/Scripts/Preload`);
  fileSystem.mkdirTree(saveRoot);
  // Nostalgist only creates the per-core state directory when its `state`
  // option is present. This adapter cannot use that option because custom mkxp-z is
  // absent from Nostalgist's core map, so own the exact directory here.
  fileSystem.mkdirTree(coreStateRoot);
  fileSystem.writeFile(bridgePath, bridgeBytes);
  if (!fileSystem.analyzePath(bridgePath).exists) {throw new Error("RPG_RUNTIME_BRIDGE_UNAVAILABLE");}
  fileSystem.writeFile(fetchManifestPath, fetchManifest);
  if (!fileSystem.analyzePath(fetchManifestPath).exists) {throw new Error("RPG_RUNTIME_CONTENT_UNAVAILABLE");}
}

function fetchEnvironment() {
  return {
    FETCH_BASE_DIR: fetchBaseDirectory,
    FETCH_CHUNK_SIZE_BYTES: String(fetchChunkSizeBytes),
    FETCH_MANIFEST: fetchManifestPath,
  };
}

function remoteContentManifest(config: MkxpParameters) {
  const entries = [
    { localPath: remoteGamePath, source: config.projectArchive },
    ...config.rtpArchives.map((archive, index) => ({
      localPath: `${systemRoot}/mkxp-z/RTP/${runtimePackFileName(index, archive.declaredName)}`,
      source: archive,
    })),
  ];
  const urls = entries.map((entry) => new URL(entry.source.url, document.baseURI));
  const origin = urls[0]?.origin;
  if (!origin || urls.some((url) => url.origin !== origin || url.username || url.password || url.hash)) {
    throw new Error("RPG_RUNTIME_CONTENT_UNAVAILABLE");
  }
  const baseUrl = `${origin}/`;
  const lines = entries.map((entry, index) => {
    const url = urls[index];
    const fetchPath = `${url.pathname.replace(/^\/+/, "")}${url.search}`;
    if (!fetchPath || /[\r\n ]/u.test(fetchPath) || /[\r\n]/u.test(entry.localPath)) {
      throw new Error("RPG_RUNTIME_CONTENT_UNAVAILABLE");
    }
    return `${fetchPath} ${entry.localPath}`;
  });
  return {
    manifest: new TextEncoder().encode([baseUrl, ...lines, ""].join("\n")),
    totalBytes: entries.reduce((total, entry) => total + entry.source.sizeBytes, 0),
  };
}

async function prepareEvidencePath(
  fileSystem: MkxpFileSystem,
  onDiagnostic: (diagnostic: { runtime: string; message: string }) => void,
) {
  // RetroArch first scopes savefile_directory by the core name and mkxp-z then
  // mounts its own mkxp-z/Saves directory below that effective save root.
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const evidencePath = currentEvidencePath(fileSystem);
    if (evidencePath) {return evidencePath;}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const gameSaveRoot = `${saveRoot}/mkxp-z/mkxp-z/Saves`;
  const names = readDirectory(fileSystem, gameSaveRoot);
  const evidencePresent = names.length === 1 &&
    fileSystem.analyzePath(`${gameSaveRoot}/${names[0]}/${evidenceName}`).exists;
  onDiagnostic({
    runtime: "mkxp-z",
    message: `RPG_RUNTIME_BRIDGE_TRACE:saveDirectories=${names.length},evidence=${String(evidencePresent)}`,
  });
  throw new Error("RPG_RUNTIME_BRIDGE_UNAVAILABLE");
}

function currentEvidencePath(fileSystem: MkxpFileSystem) {
  const gameSaveRoot = `${saveRoot}/mkxp-z/mkxp-z/Saves`;
  const names = readDirectory(fileSystem, gameSaveRoot);
  if (names.length > 1) {throw new Error("RPG_RUNTIME_BRIDGE_UNAVAILABLE");}
  if (names.length !== 1) {return null;}
  const evidencePath = `${gameSaveRoot}/${names[0]}/${evidenceName}`;
  return fileSystem.analyzePath(evidencePath).exists ? evidencePath : null;
}

function readCurrentPosition(fileSystem: MkxpFileSystem) {
  const evidencePath = currentEvidencePath(fileSystem);
  if (!evidencePath) {throw new Error("RPG_RUNTIME_POSITION_UNAVAILABLE");}
  return readPosition(fileSystem, evidencePath);
}

function readDirectory(fileSystem: MkxpFileSystem, path: string) {
  try {
    return fileSystem.readdir(path).filter((name) => name !== "." && name !== "..");
  } catch {
    return [];
  }
}

function runtimePackFileName(index: number, declaredName: string) {
  if (index < 0 || index > 2 || !declaredName || declaredName.length > 240 ||
    declaredName.includes("/") || declaredName.includes("\\") || hasControlCharacter(declaredName) ||
    declaredName === "." || declaredName === "..") {
    throw new Error("RPG_RUNTIME_PACK_INVALID");
  }
  const suffix = declaredName.toLowerCase().endsWith(".mkxpz") ? "" : ".mkxpz";
  return `${declaredName}${suffix}`;
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function readPosition(fileSystem: MkxpFileSystem, evidencePath: string) {
  if (!fileSystem.analyzePath(evidencePath).exists) {throw new Error("RPG_RUNTIME_POSITION_UNAVAILABLE");}
  const text = new TextDecoder("utf-8", { fatal: true }).decode(fileSystem.readFile(evidencePath));
  const parts = text.split(",");
  if (parts.length !== 6 || parts[0] !== "1") {throw new Error("RPG_RUNTIME_POSITION_UNAVAILABLE");}
  const values = parts.slice(1).map((value) => Number(value));
  if (values.some((value) => !Number.isSafeInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) || values[0] < 0 || values[4] < 0) {
    throw new Error("RPG_RUNTIME_POSITION_UNAVAILABLE");
  }
  return {
    position: { mapId: values[0], playerX: values[1], playerY: values[2], fixtureState: values[3] } satisfies RpgMakerPositionV1,
    frameCount: values[4],
  };
}

export async function fetchVerified(url: string, expectedSize: number, expectedDigest: string) {
  const response = await fetch(url, { credentials: "same-origin", cache: "default", redirect: "error" });
  if (!response.ok || response.url !== new URL(url, window.location.href).href) {throw new Error("RPG_RUNTIME_CONTENT_UNAVAILABLE");}
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expectedSize || await digest(bytes) !== expectedDigest) {
    throw new Error("RPG_RUNTIME_CONTENT_DIGEST_MISMATCH");
  }
  return bytes;
}

async function digest(bytes: Uint8Array) {
  const result = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice()));
  return [...result].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) {resolve(blob);}
    else {reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE"));}
  }, "image/png"));
}

async function saveStateBytes(
  canvas: HTMLCanvasElement,
  fileSystem: MkxpFileSystem,
  expectedSize: number,
  encodeCheckpoint: typeof encodeMkxpCheckpoint,
) {
  try {fileSystem.unlink(statePath);} catch { /* A previous state file is optional. */ }
  await pressPrivateHotkey(canvas, saveStateHotkey);
  const expectedPayloadSize = expectedSize + mkxpRastateEnvelopeBytes;
  const deadline = performance.now() + 120_000;
  while (performance.now() < deadline) {
    try {
      const size = fileSystem.stat(statePath).size;
      if (size > expectedPayloadSize) {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
      if (size === expectedPayloadSize) {
        const state = fileSystem.readFile(statePath);
        const core = decodeMkxpRastate(state, expectedSize);
        try {fileSystem.unlink(statePath);} catch { /* The in-memory copy is authoritative. */ }
        try {return await encodeCheckpoint(core, expectedSize);}
        catch {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
      }
    } catch (error) {
      if (error instanceof Error && error.message === "RPG_CHECKPOINT_CREATE_FAILED") {throw error;}
      // RetroArch creates the file asynchronously after completing core serialization.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("RPG_CHECKPOINT_CREATE_TIMEOUT");
}

function installRestoreState(fileSystem: MkxpFileSystem, state: Uint8Array, expectedSize: number) {
  writeState(fileSystem, statePath, state, expectedSize);
}

async function restoreStateAndWait(
  canvas: HTMLCanvasElement,
  fileSystem: MkxpFileSystem,
  expected: RpgMakerPositionV1 | null,
) {
  const before = tryReadCurrentPosition(fileSystem);
  await pressPrivateHotkey(canvas, loadStateHotkey);
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const restored = tryReadCurrentPosition(fileSystem);
    if (restored && restored.frameCount !== before?.frameCount &&
      (!expected || samePosition(restored.position, expected))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("RPG_CHECKPOINT_RESTORE_FAILED");
}

function expectedRestorePosition(config: MkxpParameters): RpgMakerPositionV1 | null {
  const evidence = config.expectedRestorePosition;
  if (!evidence) {
    throw new Error("RPG_RUNTIME_PROTOCOL_VIOLATION");
  }
  return { ...evidence };
}

function tryReadCurrentPosition(fileSystem: MkxpFileSystem) {
  try {return readCurrentPosition(fileSystem);}
  catch (error) {
    if (error instanceof Error && error.message === "RPG_RUNTIME_POSITION_UNAVAILABLE") {return null;}
    throw error;
  }
}

function samePosition(left: RpgMakerPositionV1, right: RpgMakerPositionV1) {
  return left.mapId === right.mapId && left.playerX === right.playerX &&
    left.playerY === right.playerY && left.fixtureState === right.fixtureState;
}

async function pressPrivateHotkey(
  canvas: HTMLCanvasElement,
  hotkey: typeof saveStateHotkey | typeof loadStateHotkey | typeof pauseToggleHotkey,
) {
  const KeyboardEventConstructor = canvas.ownerDocument.defaultView?.KeyboardEvent;
  if (!KeyboardEventConstructor) {throw new Error("RPG_RUNTIME_FAILED");}
  const options = {
    bubbles: true,
    cancelable: true,
    code: hotkey.code,
    key: hotkey.code,
    keyCode: hotkey.keyCode,
    which: hotkey.keyCode,
  };
  canvas.focus();
  canvas.dispatchEvent(new KeyboardEventConstructor("keydown", options));
  await new Promise((resolve) => setTimeout(resolve, 100));
  canvas.dispatchEvent(new KeyboardEventConstructor("keyup", options));
}

function writeState(fileSystem: MkxpFileSystem, path: string, state: Uint8Array, expectedSize: number) {
  let rastate: Uint8Array;
  try {rastate = encodeMkxpRastate(state, expectedSize);}
  catch {throw new Error("RPG_CHECKPOINT_RESTORE_FAILED");}
  fileSystem.writeFile(path, rastate);
  if (!fileSystem.analyzePath(path).exists || fileSystem.stat(path).size !== expectedSize + mkxpRastateEnvelopeBytes) {
    throw new Error("RPG_CHECKPOINT_RESTORE_FAILED");
  }
}
