import {afterEach, describe, expect, it, vi} from "vitest";
import {fetchVerified} from "./content.js";
import {managedAdapterFixture} from "../../tests/managed-adapter-fixture.js";
import {mountMkxp, createHarness, mkxpConfig} from "../../tests/mkxp-adapter-fixture.js";

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
  it.each([1, 2, 3])("binds bottom to RGSS Confirm, right to Cancel and leaves the keyboard to the core for RGSS %s", async (rgssVersion) => {
    const harness = createHarness();
    const config = {...mkxpConfig(), rgssVersion: rgssVersion as 1 | 2 | 3};
    const mounted = await mountMkxp(config, harness.target, null, harness.dependencies);
    // RGSS C=RetroPad A; RGSS B=RetroPad B. Explicit bindings override rwebpad.
    expect(harness.prepareOptions?.retroarchConfig).toMatchObject({
      input_player1_a_btn: "0", input_player1_b_btn: "1",
      input_player1_x_btn: "2", input_player1_y_btn: "3",
    });
    // Keyboard reaches the core only through its RGSS keyboard table.
    const retroarchConfig = harness.prepareOptions?.retroarchConfig as Record<string, unknown> | undefined;
    for (const input of ["up", "down", "left", "right", "a", "b", "x", "y", "start", "select", "gun_start", "gun_select"]) {
      expect(retroarchConfig?.[`input_player1_${input}`]).toBe("nul");
    }
    await mounted.exit();
    harness.frame.remove();
  });

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

  it("[BR-08] UNIT/mkxp-teardown waits for core-owned teardown before forcing worker cleanup or removing the canvas", async () => {
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
    expect(harness.runtime.forceExit).not.toHaveBeenCalled();
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

  it("materializes immutable core assets through the public service with a full SHA check", async () => {
    const url = new URL("/runtime/mkxp/core.js", window.location.href).href;
    const fetchMock=vi.fn(async()=>new Response(Uint8Array.of(1)));
    vi.stubGlobal("fetch",fetchMock);
    const content=managedAdapterFixture("rpgmaker-xp", {url});
    await expect(fetchVerified(url,1,"4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",content)).resolves.toEqual(Uint8Array.of(1));
    expect(fetchMock).toHaveBeenCalledOnce();
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
      FETCH_MANIFEST: "/home/web_user/retroarch/userdata/system/mkxp-z/fetch.manifest",
    });
    const manifestBytes = harness.files.get(
      "/home/web_user/retroarch/userdata/system/mkxp-z/fetch.manifest",
    );
    if (!manifestBytes) {throw new Error("missing fetch manifest");}
    const manifest = new TextDecoder().decode(manifestBytes);
    const lines=manifest.trimEnd().split("\n");
    expect(lines[0]).toBe("RETROM_CONTENT_IO_V1");expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^[0-9a-f-]{36}\t8388608\t\/retrom-content\/game.mkxpz$/u);
    expect(lines[2]).toMatch(/^[0-9a-f-]{36}\t16777216\t\/home\/web_user\/retroarch\/userdata\/system\/mkxp-z\/RTP\/Standard.mkxpz$/u);
    expect(manifest).not.toContain("http");expect(manifest).not.toContain("projects/");
    expect(harness.prepareOptions?.emscriptenModule).toHaveProperty("retromContentBridge.abi","content-io-v1");
    expect(progress).toEqual([
      { phase: "RUNTIME_ASSET", loadedBytes: 0, totalBytes: 42_745_421 },
      { phase: "RUNTIME_ASSET", loadedBytes: 42_745_421, totalBytes: 42_745_421 },
      { phase: "PROJECT_INDEX", loadedBytes: 0, totalBytes: manifestBytes.byteLength },
      {
        phase: "PROJECT_INDEX",
        loadedBytes: manifestBytes.byteLength,
        totalBytes: manifestBytes.byteLength,
      },
    ]);
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

    expect(harness.actions).toEqual(["start", "F6", "F6"]);
    expect(harness.runtime.pause).not.toHaveBeenCalled();
    expect(harness.runtime.resume).not.toHaveBeenCalled();
    await mounted.exit();
    harness.frame.remove();
  });
});
