import { afterEach, describe, expect, it, vi } from "vitest";
import { rpgMakerPositionProbeKind, type RpgMakerRuntimeConfig } from "../rpgmaker/contract";
import { fetchVerified, mountMkxp } from "./adapter";
import { encodeMkxpRastate } from "./state";

type MkxpConfig = RpgMakerRuntimeConfig & {
  adapter: Extract<RpgMakerRuntimeConfig["adapter"], { adapterKind: "MKXP_LIBRETRO_WEB" }>;
};

type TestFileSystem = {
  analyzePath(path: string): { exists: boolean };
  mkdirTree(path: string): void;
  readdir(path: string): string[];
  readFile(path: string): Uint8Array<ArrayBufferLike>;
  stat(path: string): { size: number };
  unlink(path: string): void;
  rename(from: string, to: string): void;
  writeFile(path: string, contents: Uint8Array): void;
};

const statePath = "/home/web_user/retroarch/userdata/states/mkxp-z/game.state";
const coreStateRoot = "/home/web_user/retroarch/userdata/states/mkxp-z";
const evidencePath = "/home/web_user/retroarch/userdata/saves/mkxp-z/mkxp-z/Saves/RPG RUNTIME XP-/rpg-runtime-position";
const movedEvidencePath = "/home/web_user/retroarch/userdata/saves/mkxp-z/mkxp-z/Saves/RPG RUNTIME VX-/rpg-runtime-position";
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
      mkxpConfig(false), harness.target, null, harness.dependencies, (diagnostic) => diagnostics.push(diagnostic),
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
      mkxpConfig(false), harness.target, null, harness.dependencies,
      (diagnostic) => diagnostics.push(diagnostic),
    )).rejects.toThrow("browser prepare failed");

    expect(diagnostics).toEqual([
      { runtime: "mkxp-z", message: "RPG_RUNTIME_MOUNT_FAILED:browser prepare failed" },
    ]);
    expect(harness.target.childElementCount).toBe(0);
    harness.frame.remove();
  });

  it("reports bounded filesystem state when position evidence never appears", async () => {
    const harness = createHarness();
    const diagnostics: Array<{ runtime: string; message: string }> = [];
    harness.runtime.start.mockImplementation(async () => {harness.actions.push("start");});
    const result = mountMkxp(
      mkxpConfig(false), harness.target, null, harness.dependencies,
      (diagnostic) => diagnostics.push(diagnostic),
    ).then(() => null, (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(31_000);

    await expect(result).resolves.toMatchObject({ message: "RPG_RUNTIME_BRIDGE_UNAVAILABLE" });
    expect(diagnostics).toContainEqual({
      runtime: "mkxp-z",
      message: "RPG_RUNTIME_BRIDGE_TRACE:saveDirectories=1,evidence=false",
    });
    harness.frame.remove();
  });

  it("registers project and RTP archives as strict remote files without downloading them", async () => {
    const harness = createHarness();
    const config = mkxpConfig(false);
    config.adapter.projectArchive.sizeBytes = 8_388_608;
    config.adapter.rtpArchives = [{
      declaredName: "Standard",
      kind: "SEEKABLE_BLOB",
      rangeRequired: true,
      sha256: "e".repeat(64),
      sizeBytes: 16_777_216,
      url: `/projects/${config.sessionId}/rtp/standard.mkxpz`,
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
      "/runtime/mkxp/position_bridge.rb",
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
      `projects/${config.sessionId}/game.mkxpz /retrom-content/game.mkxpz`,
      `projects/${config.sessionId}/rtp/standard.mkxpz /home/web_user/retroarch/userdata/system/mkxp-z/RTP/Standard.mkxpz`,
      "",
    ].join("\n"));
    expect(progress).toEqual([
      { phase: "RUNTIME_ASSET", loadedBytes: 0, totalBytes: 42_746_925 },
      { phase: "RUNTIME_ASSET", loadedBytes: 42_746_925, totalBytes: 42_746_925 },
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

  it("does not send the restore hotkey until the position bridge has produced evidence", async () => {
    const harness = createHarness();
    harness.runtime.start.mockImplementation(async () => {
      harness.actions.push("start");
      setTimeout(() => {
        harness.files.set(evidencePath, positionBytes(7, 3, 6, 9, 599));
      }, 500);
    });
    harness.onKeyDown = (code) => {
      harness.actions.push(code);
      if (code === "F4") {harness.files.set(evidencePath, positionBytes(7, 4, 6, 9, 600));}
    };

    const mountPromise = mountMkxp(mkxpConfig(true), harness.target, checkpointFixture, harness.dependencies);
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
      if (code === "F4") {harness.files.set(evidencePath, positionBytes(7, 4, 6, 9, 600));}
      if (code === "F2") {harness.writeRuntimeState(encodeMkxpRastate(stateFixture, stateSize));}
    };
    const mountPromise = mountMkxp(mkxpConfig(true), harness.target, checkpointFixture, harness.dependencies);

    await vi.advanceTimersByTimeAsync(1_000);

    const mounted = await mountPromise;
    expect(harness.actions).toEqual([`mkdir:${coreStateRoot}`, `write:${statePath}`, "start", "F4"]);
    expect(harness.stateAtStart?.byteLength).toBe(stateSize + 24);
    expect(harness.stateAtStart?.slice(0, 24)).toEqual(Uint8Array.of(
      0x52, 0x41, 0x53, 0x54, 0x41, 0x54, 0x45, 1,
      0x4d, 0x45, 0x4d, 0x20, 0, 0, 0, 16,
      0x6d, 0x6b, 0x78, 0x70, 1, 0, 0, 0,
    ));
    expect(mounted.getValidationProbe(rpgMakerPositionProbeKind)?.value)
      .toEqual({ mapId: 7, playerX: 4, playerY: 6, fixtureState: 9 });
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

  it("follows the current PhysFS evidence directory after restore changes it", async () => {
    const harness = createHarness();
    harness.onKeyDown = (code) => {
      harness.actions.push(code);
      if (code === "F4") {
        harness.files.delete(evidencePath);
        harness.setSaveDirectoryName("RPG RUNTIME VX-");
        harness.files.set(movedEvidencePath, positionBytes(7, 4, 6, 9, 600));
      }
    };

    const mountPromise = mountMkxp(mkxpConfig(true), harness.target, checkpointFixture, harness.dependencies);
    await vi.advanceTimersByTimeAsync(1_000);

    const mounted = await mountPromise;
    expect(mounted.getValidationProbe(rpgMakerPositionProbeKind)?.value)
      .toEqual({ mapId: 7, playerX: 4, playerY: 6, fixtureState: 9 });
    expect(mounted.getFrameCount()).toBe(600);
    await mounted.exit();
    harness.frame.remove();
  });

  it("does not declare a restore ready when the bridge never reaches saved position B", async () => {
    const harness = createHarness();
    harness.onKeyDown = (code) => {
      harness.actions.push(code);
      if (code === "F4") {harness.files.set(evidencePath, positionBytes(7, 8, 6, 10, 601));}
    };
    const result = mountMkxp(mkxpConfig(true), harness.target, checkpointFixture, harness.dependencies)
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

    await expect(mountMkxp(mkxpConfig(true), harness.target, invalidState, harness.dependencies))
      .rejects.toThrow("RPG_CHECKPOINT_RESTORE_FAILED");

    expect(harness.runtime.start).not.toHaveBeenCalled();
    expect(harness.runtime.exit).toHaveBeenCalledOnce();
    expect(harness.target.childElementCount).toBe(0);
    harness.frame.remove();
  });

  it("times out checkpoint creation without calling a direct RetroArch command", async () => {
    const harness = createHarness();
    harness.onKeyDown = (code) => {harness.actions.push(code);};
    const mountPromise = mountMkxp(mkxpConfig(false), harness.target, null, harness.dependencies);
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
    const mountPromise = mountMkxp(mkxpConfig(false), harness.target, null, harness.dependencies);
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
    const mountPromise = mountMkxp(mkxpConfig(false), harness.target, null, harness.dependencies);
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
  let saveDirectoryName = "RPG RUNTIME XP-";
  const fileSystem = {
    analyzePath: (path: string) => ({ exists: files.has(path) }),
    mkdirTree: (path: string) => {
      directories.push(path);
      if (path === coreStateRoot) {actions.push(`mkdir:${path}`);}
    },
    readdir: (path: string) => {
      if (path === "/home/web_user/retroarch/userdata/saves/mkxp-z/mkxp-z/Saves") {
        return [".", "..", saveDirectoryName];
      }
      throw new Error("ENOENT");
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
    rename: (from: string, to: string) => {
      const contents = files.get(from);
      if (!contents) {throw new Error("ENOENT");}
      files.set(to, contents);
      files.delete(from);
    },
    writeFile: (path: string, contents: Uint8Array) => {
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
    setSaveDirectoryName: (name: string) => {saveDirectoryName = name;},
    writeRuntimeState: (contents: Uint8Array) => fileSystem.writeFile(statePath, contents),
    onKeyDown: (code: string) => {void code;},
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
    files.set(evidencePath, positionBytes(7, 3, 6, 9, 599));
    actions.push("start");
  });
  harness.runtime = runtime;
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
  return {
    exit: vi.fn(async () => undefined),
    getEmscripten: () => ({ Module: { ENV: environment } }),
    getEmscriptenFS: () => fileSystem,
    pause: vi.fn(),
    resume: vi.fn(),
    start: vi.fn(async () => {onStart();}),
    environment,
  };
}

function positionBytes(mapId: number, playerX: number, playerY: number, fixtureState: number, frameCount: number) {
  return new TextEncoder().encode(`1,${mapId},${playerX},${playerY},${fixtureState},${frameCount}`);
}

function mkxpConfig(restore: boolean): MkxpConfig {
  const sessionId = "01980000-0000-7000-8000-000000000001";
  return {
    sessionId,
    generation: "RPGXP",
    validationPurpose: restore,
    expectedRestorePosition: restore ? { mapId: 7, playerX: 4, playerY: 6, fixtureState: 9 } : null,
    adapter: {
      adapterKind: "MKXP_LIBRETRO_WEB",
      adapterId: "mkxp-libretro-web",
      runtimeBaseUrl: "/runtime/mkxp/",
      core: {
        jsUrl: "/runtime/mkxp/mkxp-z_libretro.js",
        jsSizeBytes: 258192,
        jsSha256: "c".repeat(64),
        wasmUrl: "/runtime/mkxp/mkxp-z_libretro.wasm",
        wasmSizeBytes: 42487229,
        wasmSha256: "d".repeat(64),
        artifactSetSha256: "a".repeat(64),
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
    },
  };
}
