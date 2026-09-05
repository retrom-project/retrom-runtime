import { Nostalgist } from "nostalgist";
import type { MountedRuntimeAdapter, RuntimeExitReporter, RuntimeProgressReporter } from "../internal-adapter.js";
import {mkxpStatus, waitForMkxpExit, waitForMkxpFrame, waitForMkxpRestore} from "./status.js";
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
  readFile(path: string): Uint8Array;
  stat(path: string): { size: number };
  unlink(path: string): void;
  writeFile(path: string, contents: Uint8Array): void;
};

type MkxpRuntime = Pick<Nostalgist,
  "exit" | "getEmscriptenFS" | "start"
> & { getEmscriptenModule(): unknown };

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

const systemRoot = "/home/web_user/retroarch/userdata/system";
const stateRoot = "/home/web_user/retroarch/userdata/states";
const coreStateRoot = `${stateRoot}/mkxp-z`;
const statePath = `${coreStateRoot}/game.state`;
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
  // The shared frame fitter observes backing dimensions as soon as we append.
  // Leaving the HTML default (300 x 150) would freeze a 2:1 initial viewport
  // in Nostalgist and letterbox the actual 4:3 / RGSS game a second time.
  [canvas.width, canvas.height] = dimensions;
  [canvas.style.width, canvas.style.height] = dimensions.map((value) => `${value}px`);
  target.append(canvas);
  const runtimeAssetBytes = config.core.jsSizeBytes + config.core.wasmSizeBytes;
  reportProgress({ phase: "RUNTIME_ASSET", loadedBytes: 0, totalBytes: runtimeAssetBytes });
  const [jsBytes, wasmBytes] = await Promise.all([
    dependencies.fetchVerified(
      config.core.jsUrl, config.core.jsSizeBytes, config.core.jsSha256,
    ),
    dependencies.fetchVerified(
      config.core.wasmUrl, config.core.wasmSizeBytes, config.core.wasmSha256,
    ),
  ]);
  reportProgress({ phase: "RUNTIME_ASSET", loadedBytes: runtimeAssetBytes, totalBytes: runtimeAssetBytes });
  const remoteContent = remoteContentManifest(config);
  reportProgress({ phase: "PROJECT_INDEX", loadedBytes: 0, totalBytes: remoteContent.manifest.byteLength });
  const printDiagnostic = (...args: unknown[]) => {
    onDiagnostic({ runtime: "mkxp-z", message: args.map(String).join(" ") });
  };
  let hostCleanup = false;
  let started = false;
  let nativeExited = false;
  let exitPromise: Promise<void> | undefined;
  let status: ReturnType<typeof mkxpStatus> | undefined;
  let resolveNativeExit!: () => void;
  const nativeExit = new Promise<void>((resolve) => {resolveNativeExit = resolve;});
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
        if (nativeExited) {return;}
        nativeExited = true;
        resolveNativeExit();
        if (hostCleanup) {return;}
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
      // RGSS Input::C maps to RetroPad A; make its browser binding explicit.
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
    },
  });
  const exitCore = () => exitPromise ??= Promise.resolve().then(async () => {
    hostCleanup = true;
    if (started && !nativeExited) {
      // Force-exit executes C++ global destructors before terminating workers.
      // Let the owning core loop unload game/audio/browser observers first.
      status!.requestExit();
      await waitForMkxpExit(nativeExit);
    }
    await nostalgist.exit();
  });
  const fileSystem = nostalgist.getEmscriptenFS() as MkxpFileSystem;
  try {
    status = mkxpStatus(nostalgist.getEmscriptenModule());
    installRuntimeFiles(fileSystem, remoteContent.manifest);
    if (restorePayload) {
      const rawState = await dependencies.decodeCheckpoint(restorePayload, config.stateBufferBytes);
      installRestoreState(fileSystem, rawState, config.stateBufferBytes);
    }
    started = true;
    await nostalgist.start();
    reportProgress({
      phase: "PROJECT_INDEX",
      loadedBytes: remoteContent.manifest.byteLength,
      totalBytes: remoteContent.manifest.byteLength,
    });
    reportProgress({ phase: "PROJECT_CONTENT", loadedBytes: 0, totalBytes: remoteContent.totalBytes });
  } catch (error) {
    await exitCore();
    throw error;
  }
  try {
    await waitForMkxpFrame(status);
    if (restorePayload) {
      await pressPrivateHotkey(canvas, loadStateHotkey);
      await waitForMkxpRestore(status);
    }
  } catch (error) {
    await exitCore();
    throw error;
  }
  return {
    checkpoint: async () => ({
      bytes: await saveStateBytes(canvas, fileSystem, config.stateBufferBytes, dependencies.encodeCheckpoint),
      format: "mkxp-state-compact-v1",
    }),
    exit: async () => {
      await exitCore();
      target.replaceChildren();
    },
    getCanvas: () => canvas,
    getCheckpointAvailability: () => ({ available: true, blocker: null }),
    getFrameCount: () => status.frames(),
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
  fetchManifest: Uint8Array,
) {
  fileSystem.mkdirTree(`${systemRoot}/mkxp-z`);
  // Nostalgist only creates the per-core state directory when its `state`
  // option is present. This adapter cannot use that option because custom mkxp-z is
  // absent from Nostalgist's core map, so own the exact directory here.
  fileSystem.mkdirTree(coreStateRoot);
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
