import {targetContentFixture} from "./target-content-fixture.js";
import {expect, vi} from "vitest";
import {mountMkxp as mountMkxpImplementation} from "../src/mkxp/adapter.js";
export const mountMkxp: typeof mountMkxpImplementation = (...args) => {
 args[7] ??= {contentSession: targetContentFixture({open: vi.fn(),materialize:vi.fn(),closeFile:vi.fn()}, "rpgmaker-xp"),assetIndex:{}};
 return mountMkxpImplementation(...args);
};

import type {MkxpParameters} from "../src/mkxp/parameters.js";

type TestFileSystem = {
  analyzePath(path: string): { exists: boolean };
  mkdirTree(path: string): void;
  readFile(path: string): Uint8Array<ArrayBufferLike>;
  stat(path: string): { size: number };
  unlink(path: string): void;
  writeFile(path: string, contents: Uint8Array): void;
};

export const statePath = "/home/web_user/retroarch/userdata/states/mkxp-z/game.state";
export const coreStateRoot = "/home/web_user/retroarch/userdata/states/mkxp-z";
export const stateSize = 268435456;
export const stateFixture = new Uint8Array(stateSize);
stateFixture.set([0x6d, 0x6b, 0x78, 0x70, 1, 0, 0, 0]);
export const checkpointFixture = Uint8Array.of(0x52, 0x54, 0x4d, 0x4b, 0x58, 0x50, 0x53, 1, 1);
export function createHarness() {
  vi.useFakeTimers();
  Object.defineProperty(window, "crossOriginIsolated", { configurable: true, value: true });
  const files = new Map<string, Uint8Array>();
  const actions: string[] = [];
  const directories: string[] = [];
  const fileSystem = {
    analyzePath: (path: string) => ({ exists: files.has(path) }),
    mkdirTree: (path: string) => {
      directories.push(path);
      if (path === coreStateRoot) {actions.push(`mkdir:${path}`);}
    },
    readFile: (path: string) => {
      const contents = files.get(path);
      if (!contents) {throw new Error("ENOENT");}
      return contents;
    },
    stat: (path: string) => {
      const contents = files.get(path);
      if (!contents) {throw new Error("ENOENT");}
      return { size: contents.byteLength };
    },
    unlink: (path: string) => {files.delete(path);},
    writeFile: (path: string, contents: Uint8Array) => {
      // WasmFS writeFile returns an errno without creating a file when its
      // parent is absent. mkdirTree creates every ancestor, not unrelated paths.
      const parent = path.slice(0, path.lastIndexOf("/"));
      if (!directories.some((directory) => directory === parent || directory.startsWith(parent + "/"))) {return;}
      if (path === statePath && !directories.includes(coreStateRoot)) {throw new Error("ENOENT");}
      files.set(path, contents);
      if (path === statePath) {actions.push(`write:${path}`);}
    },
  };
  const harness = {
    actions,
    directories,
    files,
    fetchedUrls: [] as string[],
    emscriptenEnvironment: {} as Record<string, string>,
    writeRuntimeState: (contents: Uint8Array) => fileSystem.writeFile(statePath, contents),
    onKeyDown: (code: string) => {void code;},
    onStateRequest: (operation: string) => {void operation;},
    autoExit: true,
    canvasIdAtPrepare: null as string | null,
    prepareOptions: null as Parameters<NonNullable<Parameters<typeof mountMkxp>[3]>["prepare"]>[0] | null,
    stateAtStart: undefined as Uint8Array | undefined,
    frame: document.createElement("iframe"),
    target: undefined as unknown as HTMLElement,
    runtime: undefined as unknown as ReturnType<typeof runtimeFixture>,
    dependencies: undefined as unknown as NonNullable<Parameters<typeof mountMkxp>[3]>,
  };
  const runtime = runtimeFixture(fileSystem, () => {
    harness.stateAtStart = files.get(statePath);
    harness.runtime.observation.frames = 599;
    actions.push("start");
  });
  harness.runtime = runtime;
  runtime.requestState.mockImplementation((operation: number) => {
    runtime.observation.restore = 0;
    harness.onStateRequest(operation === 1 ? "save" : "restore");
    return 1;
  });
  runtime.requestExit.mockImplementation(() => {
    if (harness.autoExit) {harness.prepareOptions?.emscriptenModule.onExit(0);}
  });
  harness.emscriptenEnvironment = runtime.environment;
  document.body.append(harness.frame);
  const target = harness.frame.contentDocument?.createElement("div");
  if (!target || !harness.frame.contentDocument) {throw new Error("test frame unavailable");}
  harness.frame.contentDocument.body.append(target);
  harness.target = target;
  harness.dependencies = {
    decodeCheckpoint: async (checkpoint, expectedSize) => {
      if (checkpoint !== checkpointFixture || expectedSize !== stateSize) {
        throw new Error("RPG_CHECKPOINT_RESTORE_FAILED");
      }
      return stateFixture;
    },
    encodeCheckpoint: async (state, expectedSize) => {
      expect(state.byteLength).toBe(stateFixture.byteLength);
      expect(state.slice(0, 8)).toEqual(stateFixture.slice(0, 8));
      expect(state[stateSize - 1]).toBe(0);
      expect(expectedSize).toBe(stateSize);
      return checkpointFixture;
    },
    fetchVerified: async (url) => {
      harness.fetchedUrls.push(url);
      return Uint8Array.of(1);
    },
    prepare: async (options) => {
      harness.prepareOptions = options;
      if (!(options.element instanceof HTMLCanvasElement)) {throw new TypeError("invalid element");}
      for (const callback of options.emscriptenModule?.preRun ?? []) {
        callback({ ENV: runtime.environment });
      }
      harness.canvasIdAtPrepare = options.element.id;
      options.element.id = "canvas";
      options.element.addEventListener("keydown", (event) => harness.onKeyDown(event.code));
      return runtime;
    },
  };
  return harness;
}

function runtimeFixture(fileSystem: TestFileSystem, onStart: () => void) {
  const environment: Record<string, string> = {};
  const observation = {frames: 0, restore: 0};
  const requestExit = vi.fn(() => undefined);
  const requestState = vi.fn((_operation: number) => 1);
  const forceExit = vi.fn(() => undefined);
  const emscripten = {Module: {ENV: environment}, exit: forceExit};
  return {
    observation,
    requestExit,
    requestState,
    forceExit,
    getEmscriptenModule: () => ({
      _runtime_get_frame_count: () => observation.frames,
      _runtime_get_state_result: () => observation.restore,
      _runtime_request_state: requestState,
      _runtime_request_exit: requestExit,
    }),
    finishRestore: () => {
      observation.restore = 1;
      setTimeout(() => {observation.frames = 600;}, 200);
    },
    exit: vi.fn(async () => {emscripten.exit();}),
    getEmscripten: () => emscripten,
    getEmscriptenFS: () => fileSystem,
    pause: vi.fn(),
    resume: vi.fn(),
    start: vi.fn(async () => {onStart();}),
    environment,
  };
}

export function mkxpConfig(): MkxpParameters {
  const sessionId = "01980000-0000-7000-8000-000000000001";
  return {
    runtimeBaseUrl: "/runtime/mkxp/",
    core: {
        jsUrl: "/runtime/mkxp/mkxp-z_libretro.js",
        jsSizeBytes: 258192,
        jsSha256: "c".repeat(64),
        wasmUrl: "/runtime/mkxp/mkxp-z_libretro.wasm",
        wasmSizeBytes: 42487229,
        wasmSha256: "d".repeat(64),
      },
    projectArchive: {
        kind: "SEEKABLE_BLOB",
        rangeRequired: true,
        url: `/projects/${sessionId}/game.mkxpz`,
        sha256: "b".repeat(64),
        sizeBytes: 1,
      },
    rtpArchives: [],
    rgssVersion: 1,
    stateBufferBytes: stateSize,
  };
}
