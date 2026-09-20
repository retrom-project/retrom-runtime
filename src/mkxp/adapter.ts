import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {MkxpContent, fetchVerified} from "./content.js";
import {ContentIOError} from "../content-io/errors.js";
import { Nostalgist } from "nostalgist";
import type { MountedRuntimeAdapter, RuntimeExitReporter, RuntimeProgressReporter } from "../internal-adapter.js";
import {type MkxpStatus, mkxpStatus, waitForMkxpExit, waitForMkxpFrame, waitForMkxpRestore, waitForMkxpSave} from "./status.js";
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
> & { getEmscriptenModule(): unknown; getEmscripten(): {exit(status: number): void} };

type MkxpPrepareOptions = Parameters<typeof Nostalgist.prepare>[0] & {
  emscriptenModule: NonNullable<Parameters<typeof Nostalgist.prepare>[0]["emscriptenModule"]> & {
    retromContentBridge: MkxpContent["bridge"];
    onExit: (status: number) => void;
    preRun: Array<(module: { ENV: Record<string, string> }) => void>;
  };
};

type MkxpMountDependencies = {
  decodeCheckpoint: typeof decodeMkxpCheckpoint;
  encodeCheckpoint: typeof encodeMkxpCheckpoint;
  fetchVerified: typeof fetchVerified;
  prepare: (options: MkxpPrepareOptions) => Promise<MkxpRuntime>;
};

const systemRoot = "/home/web_user/retroarch/userdata/system";
const stateRoot = "/home/web_user/retroarch/userdata/states";
const coreStateRoot = `${stateRoot}/mkxp-z`;
const statePath = `${coreStateRoot}/game.state`;
const remoteGamePath = "/retrom-content/game.mkxpz";
const fetchManifestPath = `${systemRoot}/mkxp-z/fetch.manifest`;
const fetchBaseDirectory = "/retrom-fetch";
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
  content?: AdapterContentOptions & {signal?: AbortSignal; onFailure?: (error: Error) => void},
) {
  if (!content) {throw new ContentIOError("ABI_MISMATCH");}
  const bridge = new MkxpContent(content, content.onFailure ?? (() => undefined), content.signal);
  try {
    return await mountMkxpUnchecked(
      config, target, restorePayload, dependencies, onDiagnostic, reportProgress, reportExitRequested, content, bridge,
    );
  }
  catch (error) {
    await bridge.close();
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
  content: AdapterContentOptions & {signal?: AbortSignal},
  bridge: MkxpContent,
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
      config.core.jsUrl, config.core.jsSizeBytes, config.core.jsSha256, content, content.signal,
    ),
    dependencies.fetchVerified(
      config.core.wasmUrl, config.core.wasmSizeBytes, config.core.wasmSha256, content, content.signal,
    ),
  ]);
  reportProgress({ phase: "RUNTIME_ASSET", loadedBytes: runtimeAssetBytes, totalBytes: runtimeAssetBytes });
  const remoteContent = remoteContentManifest(config, bridge);
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
      retromContentBridge: bridge.bridge,
      onExit: (status) => {
        if (nativeExited) {return;}
        nativeExited = true;
        resolveNativeExit();
        onDiagnostic({ runtime: "mkxp-z", message: `RPG_RUNTIME_CORE_EXIT:${status}` });
        if (hostCleanup) {return;}
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
      input_save_state: "nul",
      input_load_state: "nul",
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
  bridge.attach(nostalgist.getEmscriptenModule() as Parameters<MkxpContent["attach"]>[0]);
  // Nostalgist 0.20.2 combines native force-exit and JS listener/blob cleanup.
  // Its public Emscripten facade must not re-enter global destruction after
  // onExit: the first exit has already terminated the supporting pthreads.
  const emscripten = nostalgist.getEmscripten();
  const forceExit = emscripten.exit;
  emscripten.exit = (status) => {if (!nativeExited) {forceExit.call(emscripten, status);}};
  const exitCore = () => exitPromise ??= Promise.resolve().then(async () => {
    hostCleanup = true;
    if (started && !nativeExited) {
      // Force-exit executes C++ global destructors before terminating workers.
      // Let the owning core loop unload game/audio/browser observers first.
      status!.requestExit();
      onDiagnostic({runtime: "mkxp-z", message: "RPG_RUNTIME_EXIT_REQUESTED"});
      await waitForMkxpExit(nativeExit);
      onDiagnostic({runtime: "mkxp-z", message: "RPG_RUNTIME_EXIT_ACKNOWLEDGED"});
    }
    await bridge.close();
    await nostalgist.exit();
    onDiagnostic({runtime: "mkxp-z", message: "RPG_RUNTIME_EXIT_DISPOSED"});
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
    await waitForMkxpFrame(status);
    if (restorePayload) {
      status.requestRestore();
      await waitForMkxpRestore(status);
      fileSystem.unlink(statePath);
    }
  } catch (error) {
    try {await exitCore();}
    catch (cleanupError) {
      onDiagnostic({runtime: "mkxp-z", message: `RPG_RUNTIME_CLEANUP_FAILED:${mountFailureMessage(cleanupError)}`});
    }
    throw error;
  }
  return {
    checkpoint: async () => ({
      bytes: await saveStateBytes(status!, fileSystem, config.stateBufferBytes, dependencies.encodeCheckpoint),
      format: "mkxp-state-v1",
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
    FETCH_MANIFEST: fetchManifestPath,
  };
}

function remoteContentManifest(config: MkxpParameters, bridge: MkxpContent) {
  bridge.register(config.projectArchive, remoteGamePath, "GAME");
  for (const [index, archive] of config.rtpArchives.entries()) {
    bridge.register(archive, `${systemRoot}/mkxp-z/RTP/${runtimePackFileName(index, archive.declaredName)}`, "FIRMWARE");
  }
  return {manifest: new TextEncoder().encode(bridge.manifest())};
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

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) {resolve(blob);}
    else {reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE"));}
  }, "image/png"));
}

async function saveStateBytes(
  status: MkxpStatus,
  fileSystem: MkxpFileSystem,
  expectedSize: number,
  encodeCheckpoint: typeof encodeMkxpCheckpoint,
) {
  status.requestSave();
  // Native preallocation exposes the full file length before any payload is
  // written. Only the owning core's close/free receipt authorizes reading it.
  await waitForMkxpSave(status);
  const expectedPayloadSize = expectedSize + mkxpRastateEnvelopeBytes;
  try {
    if (fileSystem.stat(statePath).size !== expectedPayloadSize) {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
    const state = fileSystem.readFile(statePath);
    const core = decodeMkxpRastate(state, expectedSize);
    fileSystem.unlink(statePath);
    return await encodeCheckpoint(core, expectedSize);
  } catch {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
}

function installRestoreState(fileSystem: MkxpFileSystem, state: Uint8Array, expectedSize: number) {
  writeState(fileSystem, statePath, state, expectedSize);
}

async function pressPrivateHotkey(
  canvas: HTMLCanvasElement,
  hotkey: typeof pauseToggleHotkey,
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
