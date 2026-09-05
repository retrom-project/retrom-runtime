import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVerified, mountMkxp } from "./adapter";
import { encodeMkxpRastate } from "./state";

import type {MkxpParameters} from "./parameters.js";

type TestFileSystem = {
  analyzePath(path: string): { exists: boolean };
  mkdirTree(path: string): void;
  readFile(path: string): Uint8Array<ArrayBufferLike>;
  stat(path: string): { size: number };
  unlink(path: string): void;
  writeFile(path: string, contents: Uint8Array): void;
};

const statePath = "/home/web_user/retroarch/userdata/states/mkxp-z/game.state";
const coreStateRoot = "/home/web_user/retroarch/userdata/states/mkxp-z";
const stateSize = 268435456;
const stateFixture = new Uint8Array(stateSize);
stateFixture.set([0x6d, 0x6b, 0x78, 0x70, 1, 0, 0, 0]);
const checkpointFixture = Uint8Array.of(0x52, 0x54, 0x4d, 0x4b, 0x58, 0x50, 0x53, 1, 1);
const originalCrossOriginIsolated = Object.getOwnPropertyDescriptor(window, "crossOriginIsolated");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalCrossOriginIsolated) {
    Object.defineProperty(window, "crossOriginIsolated", originalCrossOriginIsolated);
  } else {
    Reflect.deleteProperty(window, "crossOriginIsolated");
  }
});

describe("mkxp runtime mount", () => {
  it("preserves initialization errors when the failed core cannot acknowledge shutdown", async () => {
    const harness = createHarness();
    harness.autoExit = false;
    harness.runtime.start.mockRejectedValue(new Error("native startup failed"));
    const diagnostics: Array<{runtime: string; message: string}> = [];
    const result = mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies,
      (diagnostic) => diagnostics.push(diagnostic)).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toEqual(new Error("native startup failed"));
    expect(diagnostics).toContainEqual({runtime: "mkxp-z", message: "RPG_RUNTIME_CLEANUP_FAILED:RPG_RUNTIME_EXIT_TIMEOUT"});
    expect(harness.runtime.exit).not.toHaveBeenCalled();
    harness.frame.remove();
  });

  it("waits for core-owned teardown before forcing worker cleanup or removing the canvas", async () => {
    const harness = createHarness();
    harness.autoExit = false;
    const reportExit = vi.fn();
    const mounted = await mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies,
      () => undefined, () => undefined, reportExit);
    const exiting = mounted.exit();
    await vi.advanceTimersByTimeAsync(100);
    expect(harness.runtime.requestExit).toHaveBeenCalledOnce();
    expect(harness.runtime.exit).not.toHaveBeenCalled();
    expect(mounted.getCanvas()?.isConnected).toBe(true);
    harness.prepareOptions?.emscriptenModule.onExit(0);
    await exiting;
    expect(harness.runtime.exit).toHaveBeenCalledOnce();
    expect(harness.target.childElementCount).toBe(0);
    expect(reportExit).not.toHaveBeenCalled();
    harness.frame.remove();
  });

  it("reports a bounded shutdown failure without destroying live core globals", async () => {
    const harness = createHarness();
    harness.autoExit = false;
    const mounted = await mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies);
    const result = mounted.exit().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toEqual(new Error("RPG_RUNTIME_EXIT_TIMEOUT"));
    expect(harness.runtime.exit).not.toHaveBeenCalled();
    harness.frame.remove();
  });

  it.each([1, 2, 3] as const)("starts RGSS %i with native backing dimensions before the frame fitter observes it", async (rgssVersion) => {
    const harness = createHarness();
    const mounted = await mountMkxp({...mkxpConfig(), rgssVersion}, harness.target, null, harness.dependencies);
    const canvas = mounted.getCanvas();
    expect([canvas?.width, canvas?.height]).toEqual(rgssVersion === 1 ? [640, 480] : [544, 416]);
    await mounted.exit();
    harness.frame.remove();
  });

  it.each([1, 2, 3] as const)("creates the real fetch manifest parent independently of removed probes for RGSS %i", async (rgssVersion) => {
    const harness = createHarness();
    const adapter = await mountMkxp({...mkxpConfig(), rgssVersion}, harness.target, null, harness.dependencies);
    expect(harness.files.has("/home/web_user/retroarch/userdata/system/mkxp-z/fetch.manifest")).toBe(true);
    expect(harness.directories).toContain("/home/web_user/retroarch/userdata/system/mkxp-z");
    await adapter.exit();
    harness.frame.remove();
  });

  it("preserves mount failures instead of reporting its own cleanup as a game-owned exit", async () => {
    const harness = createHarness();
    vi.spyOn(harness.runtime.getEmscriptenFS(), "writeFile").mockImplementation(() => undefined);
    harness.runtime.exit.mockImplementation(async () => {harness.prepareOptions?.emscriptenModule?.onExit(0);});
    const reportExit = vi.fn();
    await expect(mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies,
      () => undefined, () => undefined, reportExit)).rejects.toThrow("RPG_RUNTIME_CONTENT_UNAVAILABLE");
    expect(reportExit).not.toHaveBeenCalled();
    expect(harness.runtime.exit).toHaveBeenCalledOnce();
    harness.frame.remove();
  });

  it("restores an ordinary checkpoint without host-provided position evidence", async () => {
    const harness = createHarness();
    harness.onKeyDown = (code) => {
      if (code === "F4") {
        harness.runtime.finishRestore();
      }
    };
    const mounting = mountMkxp(mkxpConfig(), harness.target, checkpointFixture, harness.dependencies);
    const result = mounting.then((value) => value, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toHaveProperty("checkpoint");
    harness.frame.remove();
  });

  it("lets immutable runtime assets use the browser cache", async () => {
    const url = new URL("/runtime/mkxp/core.js", window.location.href).href;
    const fetchMock = vi.fn(async () => ({
      arrayBuffer: async () => Uint8Array.of(1).buffer,
      ok: true,
      url,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchVerified(
      "/runtime/mkxp/core.js",
      1,
      "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
    )).resolves.toEqual(Uint8Array.of(1));
    expect(fetchMock).toHaveBeenCalledWith("/runtime/mkxp/core.js", {
      cache: "default", credentials: "same-origin", redirect: "error",
    });
  });

  it("forwards native stdout and stderr without using the Next development error channel", async () => {
    const harness = createHarness();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const diagnostics: unknown[] = [];
    const reportExitRequested = vi.fn();

    const mounted = await mountMkxp(
      mkxpConfig(), harness.target, null, harness.dependencies, (diagnostic) => diagnostics.push(diagnostic),
      () => undefined, reportExitRequested,
    );
    const print = harness.prepareOptions?.emscriptenModule?.print;
    const printErr = harness.prepareOptions?.emscriptenModule?.printErr;
    const onExit = harness.prepareOptions?.emscriptenModule?.onExit;
    expect(print).toBeTypeOf("function");
    expect(printErr).toBeTypeOf("function");
    print?.("[INFO] mkxp startup");
    printErr?.("[INFO] RetroArch startup");

    expect(consoleError).not.toHaveBeenCalled();
    expect(diagnostics).toEqual([
      { runtime: "mkxp-z", message: "[INFO] mkxp startup" },
      { runtime: "mkxp-z", message: "[INFO] RetroArch startup" },
    ]);
    onExit?.(0);
    expect(reportExitRequested).toHaveBeenCalledOnce();
    expect(diagnostics.at(-1)).toEqual({ runtime: "mkxp-z", message: "RPG_RUNTIME_CORE_EXIT:0" });
    await mounted.exit();
    harness.frame.remove();
  });

  it("preserves the bounded setup failure before removing the runtime canvas", async () => {
    const harness = createHarness();
    const diagnostics: Array<{ runtime: string; message: string }> = [];
    harness.dependencies.prepare = async () => {throw new Error("browser prepare failed");};

    await expect(mountMkxp(
      mkxpConfig(), harness.target, null, harness.dependencies,
      (diagnostic) => diagnostics.push(diagnostic),
    )).rejects.toThrow("browser prepare failed");

    expect(diagnostics).toEqual([
      { runtime: "mkxp-z", message: "RPG_RUNTIME_MOUNT_FAILED:browser prepare failed" },
    ]);
    expect(harness.target.childElementCount).toBe(0);
    harness.frame.remove();
  });

  it("fails startup if the core never presents a frame", async () => {
    const harness = createHarness();
    const diagnostics: Array<{ runtime: string; message: string }> = [];
    harness.runtime.start.mockImplementation(async () => {harness.actions.push("start");});
    const result = mountMkxp(
      mkxpConfig(), harness.target, null, harness.dependencies,
      (diagnostic) => diagnostics.push(diagnostic),
    ).then(() => null, (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(31_000);

    await expect(result).resolves.toMatchObject({ message: "RPG_RUNTIME_TIMEOUT" });
    expect(diagnostics).toContainEqual({
      runtime: "mkxp-z",
      message: "RPG_RUNTIME_MOUNT_FAILED:RPG_RUNTIME_TIMEOUT",
    });
    harness.frame.remove();
  });

  it("registers project and RTP archives as strict remote files without downloading them", async () => {
    const harness = createHarness();
    const config = mkxpConfig();
    config.projectArchive.sizeBytes = 8_388_608;
    config.rtpArchives = [{
      declaredName: "Standard",
      kind: "SEEKABLE_BLOB",
      rangeRequired: true,
      sha256: "e".repeat(64),
      sizeBytes: 16_777_216,
      url: "/projects/01980000-0000-7000-8000-000000000001/rtp/standard.mkxpz",
    }];
    const progress: unknown[] = [];

    const mounted = await mountMkxp(
      config,
      harness.target,
      null,
      harness.dependencies,
      () => undefined,
      (event) => progress.push(event),
    );

    expect(harness.fetchedUrls).toEqual([
      "/runtime/mkxp/mkxp-z_libretro.js",
      "/runtime/mkxp/mkxp-z_libretro.wasm",
    ]);
    expect(harness.prepareOptions).not.toHaveProperty("rom");
    expect(harness.prepareOptions).not.toHaveProperty("bios");
    expect(harness.prepareOptions?.emscriptenModule?.arguments).toEqual(["/retrom-content/game.mkxpz"]);
    expect(harness.prepareOptions?.emscriptenModule).not.toHaveProperty("ENV");
    expect(harness.emscriptenEnvironment).toEqual({
      FETCH_BASE_DIR: "/retrom-fetch",
      FETCH_CHUNK_SIZE_BYTES: "262144",
      FETCH_MANIFEST: "/home/web_user/retroarch/userdata/system/mkxp-z/fetch.manifest",
    });
    const manifestBytes = harness.files.get(
      "/home/web_user/retroarch/userdata/system/mkxp-z/fetch.manifest",
    );
    if (!manifestBytes) {throw new Error("missing fetch manifest");}
    const manifest = new TextDecoder().decode(manifestBytes);
    expect(manifest).toBe([
      window.location.origin + "/",
      "projects/01980000-0000-7000-8000-000000000001/game.mkxpz /retrom-content/game.mkxpz",
      "projects/01980000-0000-7000-8000-000000000001/rtp/standard.mkxpz /home/web_user/retroarch/userdata/system/mkxp-z/RTP/Standard.mkxpz",
      "",
    ].join("\n"));
    expect(progress).toEqual([
      { phase: "RUNTIME_ASSET", loadedBytes: 0, totalBytes: 42_745_421 },
      { phase: "RUNTIME_ASSET", loadedBytes: 42_745_421, totalBytes: 42_745_421 },
      { phase: "PROJECT_INDEX", loadedBytes: 0, totalBytes: manifestBytes.byteLength },
      {
        phase: "PROJECT_INDEX",
        loadedBytes: manifestBytes.byteLength,
        totalBytes: manifestBytes.byteLength,
      },
      { phase: "PROJECT_CONTENT", loadedBytes: 0, totalBytes: 25_165_824 },
    ]);
    await mounted.exit();
    harness.frame.remove();
  });

  it("does not send the restore hotkey before the core has presented a frame", async () => {
    const harness = createHarness();
    harness.runtime.start.mockImplementation(async () => {
      harness.actions.push("start");
      setTimeout(() => {
        harness.runtime.observation.frames = 599;
      }, 500);
    });
    harness.onKeyDown = (code) => {
      harness.actions.push(code);
      if (code === "F4") {harness.runtime.finishRestore();}
    };

    const mountPromise = mountMkxp(mkxpConfig(), harness.target, checkpointFixture, harness.dependencies);
    await vi.advanceTimersByTimeAsync(499);

    expect(harness.actions).toEqual([`mkdir:${coreStateRoot}`, `write:${statePath}`, "start"]);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(mountPromise).resolves.toBeDefined();
    expect(harness.actions).toEqual([`mkdir:${coreStateRoot}`, `write:${statePath}`, "start", "F4"]);
    harness.frame.remove();
  });

  it("loads an exact restore through F4 before ready and saves through F2 in the core loop", async () => {
    const harness = createHarness();
    harness.onKeyDown = (code) => {
      harness.actions.push(code);
      if (code === "F4") {harness.runtime.finishRestore();}
      if (code === "F2") {harness.writeRuntimeState(encodeMkxpRastate(stateFixture, stateSize));}
    };
    const mountPromise = mountMkxp(mkxpConfig(), harness.target, checkpointFixture, harness.dependencies);

    await vi.advanceTimersByTimeAsync(1_000);

    const mounted = await mountPromise;
    expect(harness.actions).toEqual([`mkdir:${coreStateRoot}`, `write:${statePath}`, "start", "F4"]);
    expect(harness.stateAtStart?.byteLength).toBe(stateSize + 24);
    expect(harness.stateAtStart?.slice(0, 24)).toEqual(Uint8Array.of(
      0x52, 0x41, 0x53, 0x54, 0x41, 0x54, 0x45, 1,
      0x4d, 0x45, 0x4d, 0x20, 0, 0, 0, 16,
      0x6d, 0x6b, 0x78, 0x70, 1, 0, 0, 0,
    ));
    expect(mounted.getFrameCount()).toBe(600);
    expect(harness.prepareOptions?.retroarchConfig).toMatchObject({
      input_save_state: "f2",
      input_load_state: "f4",
      input_pause_toggle: "f6",
      input_player1_a: "x",
      savestate_file_compression: false,
    });
    expect(harness.canvasIdAtPrepare).toBe("canvas");
    expect(harness.directories).toContain(coreStateRoot);
    expect("state" in (harness.prepareOptions ?? {})).toBe(false);
    expect(mounted.getCanvas()?.ownerDocument).toBe(harness.frame.contentDocument);
    expect(harness.prepareOptions?.element).toBe(mounted.getCanvas());
    expect(mounted.getCanvas()?.id).toBe("canvas");
    expect(mounted.getCanvas()?.style.width).toBe("640px");
    expect(mounted.getCanvas()?.style.height).toBe("480px");

    const screenshot = new Blob([Uint8Array.of(1)], { type: "image/png" });
    Object.defineProperty(mounted.getCanvas(), "toBlob", {
      configurable: true,
      value: (callback: BlobCallback) => callback(screenshot),
    });
    expect(await mounted.screenshot()).toBe(screenshot);

    const checkpointPromise = mounted.checkpoint();
    await vi.advanceTimersByTimeAsync(1_000);
    const checkpoint = await checkpointPromise;
    expect(checkpoint.bytes.byteLength).toBeLessThan(1024);
    expect(checkpoint.bytes.slice(0, 8)).toEqual(Uint8Array.of(0x52, 0x54, 0x4d, 0x4b, 0x58, 0x50, 0x53, 1));
    expect(checkpoint).toEqual({ bytes: checkpointFixture, format: "mkxp-state-compact-v1" });
    expect(harness.actions).toEqual([
      `mkdir:${coreStateRoot}`, `write:${statePath}`, "start", "F4", "F2", `write:${statePath}`,
    ]);
    expect(harness.runtime).not.toHaveProperty("sendCommand");
    expect(harness.runtime).not.toHaveProperty("saveState");
    expect(harness.runtime).not.toHaveProperty("loadState");
    await mounted.exit();
    harness.frame.remove();
  });

  it("does not declare a restore ready merely because frames continue advancing", async () => {
    const harness = createHarness();
    harness.onKeyDown = (code) => {
      harness.actions.push(code);
      if (code === "F4") {harness.runtime.observation.frames = 601;}
    };
    const result = mountMkxp(mkxpConfig(), harness.target, checkpointFixture, harness.dependencies)
      .then(() => null, (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(31_000);

    await expect(result).resolves.toMatchObject({ message: "RPG_CHECKPOINT_RESTORE_FAILED" });
    expect(harness.actions).toEqual([`mkdir:${coreStateRoot}`, `write:${statePath}`, "start", "F4"]);
    expect(harness.runtime.exit).toHaveBeenCalledOnce();
    expect(harness.target.childElementCount).toBe(0);
    harness.frame.remove();
  });

  it("maps a malformed raw core restore payload to the restore failure stage", async () => {
    const harness = createHarness();
    const invalidState = new Uint8Array(stateSize);

    await expect(mountMkxp(mkxpConfig(), harness.target, invalidState, harness.dependencies))
      .rejects.toThrow("RPG_CHECKPOINT_RESTORE_FAILED");

    expect(harness.runtime.start).not.toHaveBeenCalled();
    expect(harness.runtime.exit).toHaveBeenCalledOnce();
    expect(harness.target.childElementCount).toBe(0);
    harness.frame.remove();
  });

  it("times out checkpoint creation without calling a direct RetroArch command", async () => {
    const harness = createHarness();
    harness.onKeyDown = (code) => {harness.actions.push(code);};
    const mountPromise = mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies);
    await vi.advanceTimersByTimeAsync(1_000);
    const mounted = await mountPromise;
    const result = mounted.checkpoint().then(() => null, (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(121_000);

    await expect(result).resolves.toMatchObject({ message: "RPG_CHECKPOINT_CREATE_TIMEOUT" });
    expect(harness.actions).toEqual([`mkdir:${coreStateRoot}`, "start", "F2"]);
    expect(harness.runtime).not.toHaveProperty("sendCommand");
    await mounted.exit();
    harness.frame.remove();
  });

  it("maps compact checkpoint encoding failures to the create stage", async () => {
    const harness = createHarness();
    harness.onKeyDown = (code) => {
      harness.actions.push(code);
      if (code === "F2") {harness.writeRuntimeState(encodeMkxpRastate(stateFixture, stateSize));}
    };
    harness.dependencies.encodeCheckpoint = async () => {throw new Error("worker failed");};
    const mountPromise = mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies);
    await vi.advanceTimersByTimeAsync(1_000);
    const mounted = await mountPromise;

    const result = mounted.checkpoint().then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toMatchObject({ message: "RPG_CHECKPOINT_CREATE_FAILED" });
    await mounted.exit();
    harness.frame.remove();
  });

  it("pauses and resumes through the core input loop without calling Nostalgist GL commands", async () => {
    const harness = createHarness();
    harness.runtime.pause.mockImplementation(() => {throw new Error("useProgram");});
    harness.runtime.resume.mockImplementation(() => {throw new Error("useProgram");});
    harness.onKeyDown = (code) => {harness.actions.push(code);};
    const mountPromise = mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies);
    await vi.advanceTimersByTimeAsync(1_000);
    const mounted = await mountPromise;
    const pause = mounted.pause();
    await vi.advanceTimersByTimeAsync(100);
    await pause;
    const resume = mounted.resume();
    await vi.advanceTimersByTimeAsync(100);
    await resume;

    expect(harness.actions).toEqual([`mkdir:${coreStateRoot}`, "start", "F6", "F6"]);
    expect(harness.runtime.pause).not.toHaveBeenCalled();
    expect(harness.runtime.resume).not.toHaveBeenCalled();
    await mounted.exit();
    harness.frame.remove();
  });
});

function createHarness() {
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
  return {
    observation,
    requestExit,
    getEmscriptenModule: () => ({
      _runtime_get_frame_count: () => observation.frames,
      _runtime_get_restore_result: () => observation.restore,
      _runtime_request_exit: requestExit,
    }),
    finishRestore: () => {
      observation.restore = 1;
      setTimeout(() => {observation.frames = 600;}, 200);
    },
    exit: vi.fn(async () => undefined),
    getEmscripten: () => ({ Module: { ENV: environment } }),
    getEmscriptenFS: () => fileSystem,
    pause: vi.fn(),
    resume: vi.fn(),
    start: vi.fn(async () => {onStart();}),
    environment,
  };
}

function mkxpConfig(): MkxpParameters {
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
