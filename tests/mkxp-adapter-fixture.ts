import {targetContentFixture} from "./target-content-fixture.js";
import {vi} from "vitest";
import {mountMkxp as mountMkxpImplementation} from "../src/mkxp/adapter.js";
export const mountMkxp: typeof mountMkxpImplementation = (...args) => {
 args[7] ??= {contentSession: targetContentFixture({open: vi.fn(),materialize:vi.fn(),closeFile:vi.fn()}, "rpgmaker-xp"),assetIndex:{}};
 return mountMkxpImplementation(...args);
};

import type {MkxpParameters} from "../src/mkxp/parameters.js";

import {rpgSaveFileSystem} from "./rpg-save-files-fixture.js";
import type {RpgSaveFileSystem} from "../src/rpgmaker/native-files.js";

export function createHarness() {
  vi.useFakeTimers();
  Object.defineProperty(window, "crossOriginIsolated", { configurable: true, value: true });
  const {files, directories, fs: fileSystem} = rpgSaveFileSystem();
  const actions: string[] = [];
  const harness = {
    actions,
    directories,
    files,
    fetchedUrls: [] as string[],
    emscriptenEnvironment: {} as Record<string, string>,
    onKeyDown: (code: string) => {void code;},
    autoExit: true,
    canvasIdAtPrepare: null as string | null,
    prepareOptions: null as Parameters<NonNullable<Parameters<typeof mountMkxp>[3]>["prepare"]>[0] | null,
    frame: document.createElement("iframe"),
    target: undefined as unknown as HTMLElement,
    runtime: undefined as unknown as ReturnType<typeof runtimeFixture>,
    dependencies: undefined as unknown as NonNullable<Parameters<typeof mountMkxp>[3]>,
  };
  const runtime = runtimeFixture(fileSystem, () => {
    harness.runtime.observation.frames = 599;
    actions.push("start");
  });
  harness.runtime = runtime;
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

function runtimeFixture(fileSystem: RpgSaveFileSystem, onStart: () => void) {
  const environment: Record<string, string> = {};
  const observation = {frames: 0, restore: 0, failure: 0};
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
      _runtime_get_game_result: () => observation.failure,
      _runtime_request_state: requestState,
      _runtime_request_exit: requestExit,
    }),
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
  };
}
