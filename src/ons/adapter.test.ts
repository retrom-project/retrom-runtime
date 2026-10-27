import type {ContentSessionClient} from "../content-io/client.js";
import {managedAdapterFixture} from "../../tests/managed-adapter-fixture.js";
import {decodeStoredCheckpoint} from "../provider/checkpoint-storage.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {config, fakeModule, loadRuntimeScript, mockIndex, requestUrl, type FakeModule, type HostWindow} from "../../tests/ons-adapter-fixture.js";
import {contentBootstrap, currentWindowHost} from "../../tests/provider-adapter-fixture.js";
import { decodeOnsCheckpoint, encodeOnsCheckpoint } from "./checkpoint.js";
import { createRuntime } from "../index.js";


afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, "getGamepads");
  delete (window as HostWindow).onsyuri;
  delete (window as HostWindow).onsyuriHostReady;
  delete (window as HostWindow).g_onsyuri_content;
  document.head.querySelectorAll("script[data-runtime=ons-yuri]").forEach((script) => script.remove());
  document.body.replaceChildren();
});

describe("ONS Yuri runtime", () => {
  it("declares native saves instead of capturing execution state", () => {
    expect(config().runtime.checkpoint).toMatchObject({semantics: "GAME_SAVE",
      writeFormat: "ons-game-save-v1-storage-v1", readFormats: ["ons-game-save-v1-storage-v1"]});
  });

  it.each([false, true])("exports changed native files on normal exit (progress: %s)", async progress => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(null));
    const module = fakeModule();
    let configured: FakeModule | undefined;
    (window as HostWindow).onsyuri = vi.fn(async options => {
      Object.assign(options, module); configured = options as FakeModule;
      configured.preRun?.(); return configured;
    });
    mockIndex();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const exits: unknown[] = [];
    runtime.subscribe(event => {if (event.type === "EXIT_REQUESTED") {exits.push(event);}});
    const mounting = runtime.mount(document.createElement("div"));
    await loadRuntimeScript(); await mounting;
    if (progress) {
      module.FS.writeFile("/save/save1.dat", Uint8Array.of(4, 2));
      (window as HostWindow).flush_save?.();
      module.FS.writeFile("/save/envdata", Uint8Array.of(7));
    }
    configured?.onExit?.(0); configured?.onExit?.(0);
    await vi.waitFor(() => expect(exits).toHaveLength(1));
    if (progress) {
      expect(exits[0]).toMatchObject({finalSnapshot: {checkpoint: {format: "ons-game-save-v1-storage-v1"}}});
      const saved = (exits[0] as {finalSnapshot: {checkpoint: {bytes: Uint8Array; format: string}}}).finalSnapshot.checkpoint;
      const restored = await decodeOnsCheckpoint(await decodeStoredCheckpoint(saved.bytes, saved.format, 64 * 1024 * 1024));
      expect(restored.entries).toEqual([{path: "envdata", data: Uint8Array.of(7)}, {path: "save1.dat", data: Uint8Array.of(4, 2)}]);
    } else {expect(exits[0]).not.toHaveProperty("finalSnapshot");}
    expect(module._onsyuri_host_save).not.toHaveBeenCalled();
    expect(module._onsyuri_host_load).not.toHaveBeenCalled();
    await runtime.exit();
  });

  it("enables sync after a successful native save even outside an instant-checkpoint wait", async () => {
    const module = fakeModule();
    module._onsyuri_host_checkpoint_ready.mockReturnValue(0);
    (window as HostWindow).onsyuri = vi.fn(async options => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      return configured;
    });
    mockIndex();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    await loadRuntimeScript(); await mounting;
    try {
      module.FS.writeFile("/save/envdata", Uint8Array.of(4));
      expect(runtime.getCheckpointAvailability()).toMatchObject({available: false, reason: "NO_SAVE"});
      module.FS.writeFile("/save/save1.dat", Uint8Array.of(1, 2, 3));
      module.FS.writeFile("/save/save1.compat", Uint8Array.of(5, 6));
      (window as HostWindow).flush_save?.();
      expect(runtime.getCheckpointAvailability()).toMatchObject({available: true,
        save: {capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false, dataKind: "PROGRESS"}});
      const saved = await runtime.checkpoint();
      expect(saved.format).toBe("ons-game-save-v1-storage-v1");
      expect(module._onsyuri_host_save).not.toHaveBeenCalled();
      expect(module._onsyuri_host_load).not.toHaveBeenCalled();
      const restored = await decodeOnsCheckpoint(await decodeStoredCheckpoint(saved.bytes, saved.format, 64 * 1024 * 1024));
      expect(restored.entries.map(entry => entry.path)).toEqual(["envdata", "save1.compat", "save1.dat"]);
      await runtime.acknowledgeCheckpoint?.(saved);
      expect(runtime.getCheckpointAvailability()).toMatchObject({available: false, reason: "UNCHANGED"});
      module.FS.writeFile("/save/save1.dat", Uint8Array.of(7, 8));
      (window as HostWindow).flush_save?.();
      await runtime.acknowledgeCheckpoint?.(saved);
      expect(runtime.getCheckpointAvailability()).toMatchObject({available: true});
    } finally {await runtime.exit();}
  });

  it.each(["startup", "exit"])("cleans globals when native stop throws during %s", async phase => {
    const module = fakeModule();
    module._onsyuri_host_stop.mockImplementation(() => {throw new Error("ONS_STOP_FAILED");});
    if (phase === "startup") {module.callMain.mockImplementation(() => {throw new Error("ONS_RUNTIME_START_FAILED");});}
    (window as HostWindow).onsyuri = vi.fn(async options => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      return configured;
    });
    mockIndex();
    const target = document.createElement("div");
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(target);
    // Observe rejection immediately so the synthetic failure cannot leak an unhandled promise.
    const mounted = phase === "startup" ? expect(mounting).rejects.toThrow("ONS_RUNTIME_START_FAILED") : mounting;
    await loadRuntimeScript(); await mounted;
    if (phase === "exit") {await runtime.exit().catch(() => undefined);}
    expect(Reflect.get(window, "g_onsyuri_module")).toBeUndefined();
    expect((window as HostWindow).g_onsyuri_content).toBeUndefined();
    expect(target.childElementCount).toBe(0);
    expect(document.head.querySelector("script[data-runtime=ons-yuri]")).toBeNull();
  });

  it("terminates the native async runtime before restoring globals on exit", async () => {
    const module = fakeModule();
    let globalsPresentOnStop = false;
    module._onsyuri_host_stop.mockImplementation(() => {
      globalsPresentOnStop = !!Reflect.get(window, "g_onsyuri_module") && (window as HostWindow).g_onsyuri_content?.abi === "ons-content-io-v1";
    });
    (window as HostWindow).onsyuri = vi.fn(async options => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      return configured;
    });
    mockIndex();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    await loadRuntimeScript(); await mounting;
    await runtime.exit(); await runtime.exit();
    expect(module._onsyuri_host_stop).toHaveBeenCalledOnce();
    expect(globalsPresentOnStop).toBe(true);
    expect(Reflect.get(window, "g_onsyuri_module")).toBeUndefined();
  });

  it("does not turn settings or an old slot into a newly completed native save", async () => {
    const module = fakeModule();
    (window as HostWindow).onsyuri = vi.fn(async options => {
      Object.assign(options, module); (options as FakeModule).preRun?.(); return options as FakeModule;
    });
    mockIndex();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    await loadRuntimeScript(); await mounting;
    module.FS.writeFile("/save/envdata", Uint8Array.of(1));
    module.FS.writeFile("/save/save1.dat", Uint8Array.of(2));
    expect(runtime.getCheckpointAvailability()).toMatchObject({available: false, reason: "NO_SAVE"});
    await expect(runtime.checkpoint()).rejects.toThrow();
    expect(module._onsyuri_host_save).not.toHaveBeenCalled();
    await runtime.exit();
  });

  it("requires the native lifecycle ABI before starting the engine", async () => {
    const module = fakeModule();
    Reflect.deleteProperty(module, "_onsyuri_host_is_ready");
    (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      return options as FakeModule;
    });
    mockIndex();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    await loadRuntimeScript();
    await expect(mounting).rejects.toThrow("ONS_RUNTIME_ARTIFACT_INVALID");
    expect(module.callMain).not.toHaveBeenCalled();
    await runtime.exit();
  });

  it("reports the engine process exit and makes checkpointing unavailable", async () => {
    const module = fakeModule();
    let configured: FakeModule | undefined;
    (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      configured = options as FakeModule;
      configured.preRun?.();
      return configured;
    });
    mockIndex();
    const events: string[] = [];
    const runtime = await createRuntime(config(), currentWindowHost(null));
    runtime.subscribe((event) => events.push(event.type));
    const mounting = runtime.mount(document.createElement("div"));
    await loadRuntimeScript();
    await mounting;

    configured?.onExit?.(0);

    await vi.waitFor(() => expect(runtime.getState()).toBe("EXITED"));
    expect(events.filter((type) => type === "EXIT_REQUESTED")).toHaveLength(1);
    expect(runtime.getCheckpointAvailability()).toEqual({ available: false, reason: "NOT_READY" });
  });

  it("maps the standard gamepad left stick to directional keyboard input", async () => {
    const module = fakeModule();
    (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      return configured;
    });
    mockIndex();
    const animationFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const axes = [0, 0];
    Object.defineProperty(window.navigator, "getGamepads", {
      configurable: true,
      value: vi.fn(() => [{ axes, connected: true, mapping: "standard" }]),
    });
    const target = document.createElement("div");
    document.body.append(target);
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(target);
    await loadRuntimeScript();
    await mounting;
    const canvas = document.querySelector("#game")!.querySelector("canvas");
    if (!canvas) {throw new Error("test canvas missing");}
    const inputs: string[] = [];
    canvas.addEventListener("keydown", (event) => inputs.push(`down:${event.key}`));
    canvas.addEventListener("keyup", (event) => inputs.push(`up:${event.key}`));

    axes[0] = 0.75;
    animationFrames.shift()?.(1);
    axes[0] = 0;
    animationFrames.shift()?.(2);

    expect(inputs).toEqual(["down:ArrowRight", "up:ArrowRight"]);
    await runtime.exit();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("reads only the files each native instance opens, by range, without a fictitious whole-project download", async () => {
    const projectFiles = [
      { path: "0.txt", bytes: Uint8Array.of(1) },
      { path: "default.ttf", bytes: Uint8Array.of(2, 3) },
      { path: "arc.nsa", bytes: Uint8Array.of(4, 5, 6, 7) },
    ];
    const indexBody = JSON.stringify({
      schemaVersion: 1,
      files: projectFiles.map(({ path, bytes }) => ({
        path,
        sizeBytes: bytes.byteLength, sha256: "a".repeat(64), mediaType: "application/octet-stream",
        url: `https://content.example/${path}`,
      })),
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/index.json")) {return new Response(indexBody, { status: 200 });}
      const file = projectFiles.find(({ path }) => url.endsWith(`/${path}`));
      if (!file) {return new Response(null, { status: 404 });}
      const range = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(input instanceof Request ? input.headers : init?.headers).get("Range") ?? "");
      const start = range ? Number(range[1]) : 0, end = range ? Math.min(Number(range[2]), file.bytes.byteLength - 1) : file.bytes.byteLength - 1;
      return new Response(file.bytes.slice(start, end + 1), {
        headers: {"content-length": String(end - start + 1), etag: `"${file.path}-v1"`,
          ...(range ? {"content-range": `bytes ${start}-${end}/${file.bytes.byteLength}`} : {})},
        status: range ? 206 : 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const bootstrap = contentBootstrap, previous = bootstrap.getMockImplementation()!;
    const session = managedAdapterFixture("onscripter-yuri", {url: "https://content.example"}).contentSession;
    bootstrap.mockImplementation(async () => ({...session, close: vi.fn(async () => {}), fail: vi.fn()}) as unknown as ContentSessionClient);
    try {

    for (let run = 0; run < 2; run += 1) {
      const module = fakeModule();
      (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
        Object.assign(options, module);
        const configured = options as FakeModule;
        configured.preRun?.();
        const bridge = (window as HostWindow).g_onsyuri_content!;
        for (const file of projectFiles) {
          const handle = await bridge.open(`/game/${file.path}`);
          expect(handle).toBeGreaterThan(0); expect(bridge.size(handle)).toBe(file.bytes.byteLength);
          expect(await bridge.read(handle, 0, file.bytes.byteLength)).toEqual(file.bytes);
          bridge.close(handle);
        }
        expect(await bridge.open("/game/missing.nsa")).toBe(0);
        return configured;
      });
      const progress: Array<{ loadedBytes: number; totalBytes: number | null; type: "LOAD_PROGRESS" }> = [];
      const runtime = await createRuntime(config(), currentWindowHost(null));
      runtime.subscribe((event) => {
        if (event.type === "LOAD_PROGRESS") {progress.push(event);}
      });
      const mounting = runtime.mount(document.createElement("div"));
      await loadRuntimeScript();
      await mounting;
      expect(progress.at(-1)).toEqual({
        loadedBytes: 1, totalBytes: 1, type: "LOAD_PROGRESS",
      });
      await runtime.exit();
    }

    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input)).filter((url) => !url.endsWith("/index.json")))
      // The second native instance reads the same ranges from the session's cached blocks.
      .toEqual(projectFiles.map(({ path }) => `https://content.example/${path}`));
    } finally {bootstrap.mockImplementation(previous);}
  });

  it("retains the WebGL drawing buffer used by review and save screenshots", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const module = fakeModule();
    (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      const canvas = document.getElementById("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {throw new Error("test canvas missing");}
      canvas.getContext("webgl", { alpha: false, preserveDrawingBuffer: false });
      const configured = options as FakeModule;
      configured.preRun?.();
      return configured;
    });
    mockIndex();
    const target = document.createElement("div");
    document.body.append(target);
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(target);
    await loadRuntimeScript();
    await mounting;

    expect(getContext).toHaveBeenCalledWith("webgl", {
      alpha: false,
      preserveDrawingBuffer: true,
    });
    await runtime.exit();
  });

  it("mounts the tagged core, accepts keyboard focus and exports native slots", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const module = fakeModule();
    const factory = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.printErr?.("INFO: normal ONS startup diagnostic");
      configured.preRun?.();
      expect(typeof (window as HostWindow).scale_full).toBe("function");
      const canvas = document.getElementById("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {throw new Error("test canvas missing");}
      canvas.width = 800;
      canvas.height = 600;
      (window as HostWindow).scale_full?.(canvas, 4 / 3);
      expect(canvas.style.width).not.toBe("");
      return configured;
    });
    (window as HostWindow).onsyuri = factory;
    mockIndex();
    const target = document.createElement("div");
    document.body.append(target);
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(target);
    await loadRuntimeScript();
    await mounting;

    expect(module.callMain).toHaveBeenCalledWith([
      "--root", "/game", "--font", "/game/default.ttf", "--save-dir", "/save", "--enc:utf8",
    ]);
    expect(runtime.getCheckpointAvailability()).toMatchObject({ available: false, reason: "NO_SAVE" });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(document.querySelector("#game")!.firstElementChild?.getAttribute("data-ons-runtime-surface")).toBe("");
    expect((document.querySelector("#game")!.firstElementChild as HTMLElement).style.display).toBe("grid");
    expect((document.querySelector("#game")!.firstElementChild as HTMLElement).style.placeItems).toBe("center");
    expect(document.activeElement).toBe(document.querySelector("#game")!.querySelector("canvas"));
    document.querySelector("#game")!.querySelector("canvas")?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.activeElement).toBe(document.querySelector("#game")!.querySelector("canvas"));

    module.FS.writeFile("/save/save2.dat", Uint8Array.of(3, 2, 1));
    (window as HostWindow).flush_save?.();
    const checkpoint = await runtime.checkpoint();
    expect(checkpoint.format).toBe("ons-game-save-v1-storage-v1");
    const decoded = await decodeOnsCheckpoint(await decodeStoredCheckpoint(checkpoint.bytes, checkpoint.format, 64 * 1024 * 1024));
    expect(decoded.entries.map((entry) => entry.path)).toContain("save2.dat");
    expect(module._onsyuri_host_save).not.toHaveBeenCalled();
    expect(module._onsyuri_host_load).not.toHaveBeenCalled();
    expect(module._onsyuri_host_set_paused).not.toHaveBeenCalled();

    await runtime.exit();
    expect(document.querySelector("#game")).toBeNull();
    expect(document.head.querySelector("script[data-runtime=ons-yuri]")).toBeNull();
  });

  it("imports native files before ordinary startup and leaves loading to the game", async () => {
    const restore = await encodeOnsCheckpoint({
      entries: [{ path: "save2.dat", data: Uint8Array.of(8, 6, 7, 5) }],
    });
    const module = fakeModule();
    (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      expect(configured.FS.readFile("/save/save2.dat")).toBeInstanceOf(Uint8Array);
      return configured;
    });
    mockIndex();
    const target = document.createElement("div");
    document.body.append(target);
    const runtime = await createRuntime(config(), currentWindowHost(restore));
    const mounting = runtime.mount(target);
    await loadRuntimeScript();
    await mounting;

    expect(module._onsyuri_host_set_restore_slot).not.toHaveBeenCalled();
    expect(module._onsyuri_host_load).not.toHaveBeenCalled();
    expect(runtime.getCheckpointAvailability()).toMatchObject({available: false, reason: "UNCHANGED"});
    await runtime.exit();
  });

  it("rejects a damaged native save before starting the engine", async () => {
    const payload = await encodeOnsCheckpoint({entries: [{path: "save1.dat", data: Uint8Array.of(1, 2, 3)}]});
    payload[payload.length - 1] ^= 1;
    const factory = vi.fn(); (window as HostWindow).onsyuri = factory;
    mockIndex();
    const runtime = await createRuntime(config(), currentWindowHost(payload));
    await expect(runtime.mount(document.createElement("div"))).rejects.toThrow("ONS_CHECKPOINT_RESTORE_FAILED");
    expect(factory).not.toHaveBeenCalled();
  });

  it("streams a requested video from its host URL without materializing it in the core file system", async () => {
    const module = fakeModule();
    (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      return configured;
    });
    const body = JSON.stringify({
      schemaVersion: 1,
      files: [
        { path: "0.txt", sizeBytes: 1, sha256: "a".repeat(64), mediaType: "application/octet-stream", url: "https://content.example/0.txt" },
        { path: "default.ttf", sizeBytes: 1, sha256: "a".repeat(64), mediaType: "application/octet-stream", url: "https://content.example/default.ttf" },
        { path: "movie/intro.mp4", sizeBytes: 50_000_000, sha256: "a".repeat(64), mediaType: "application/octet-stream", url: "https://content.example/movie/intro.mp4" },
      ],
    });
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const target = document.createElement("div");
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(target);
    await loadRuntimeScript();
    await mounting;

    const playVideo = (window as HostWindow & { playVideo?: (path: string, click: boolean, loop: boolean) => void }).playVideo;
    if (!playVideo) {throw new Error("test video bridge missing");}
    playVideo("/game/movie/intro.mp4", false, false);

    expect(document.querySelector("#game")!.querySelector("video")?.src).toBe("https://content.example/movie/intro.mp4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(() => module.FS.readFile("/game/movie/intro.mp4")).toThrow();
    await runtime.exit();
  });

  it("accepts same-origin root-relative project content URLs", async () => {
    const module = fakeModule();
    (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      return configured;
    });
    const body = JSON.stringify({
      schemaVersion: 1,
      files: [
        { path: "0.txt", sizeBytes: 1, sha256: "a".repeat(64), mediaType: "application/octet-stream", url: `/runtime/content/project/${"a".repeat(64)}/0.txt` },
        { path: "default.ttf", sizeBytes: 1, sha256: "a".repeat(64), mediaType: "application/octet-stream", url: `/runtime/content/project/${"a".repeat(64)}/default.ttf` },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    await loadRuntimeScript();
    await mounting;
    await runtime.exit();
  });

  it("loads a same-origin runtime from a root-relative base URL", async () => {
    const module = fakeModule();
    (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      return configured;
    });
    mockIndex();
    const runtimeConfig = config();
    runtimeConfig.runtime.runtimeBaseUrl = "/runtime/providers/retrom-runtime/" + "b".repeat(64) + "/";
    const runtime = await createRuntime(runtimeConfig, currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    await loadRuntimeScript();
    expect(document.head.querySelector<HTMLScriptElement>("script[data-runtime=ons-yuri]")?.src)
      .toBe(new URL(runtimeConfig.runtime.runtimeBaseUrl + "assets/ons/onsyuri.js", document.baseURI).href);
    await mounting;
    await runtime.exit();
  });

  it("starts projects that include empty auxiliary files", async () => {
    const module = fakeModule();
    (window as HostWindow).onsyuri = vi.fn(async options => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      return configured;
    });
    const files = ["0.txt", "default.ttf", "empty.txt"].map(path => ({path,
      sizeBytes: path === "empty.txt" ? 0 : 1, sha256: "a".repeat(64),
      mediaType: "application/octet-stream", url: `https://content.example/${path}`}));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1, files}))));
    const runtime = await createRuntime(config(), currentWindowHost(null));
    let failure: unknown;
    const mounting = runtime.mount(document.createElement("div")).catch(error => {failure = error;});
    await vi.waitFor(() => expect(failure || document.head.querySelector("script[data-runtime=ons-yuri]")).toBeTruthy());
    if (failure) {throw failure;}
    await loadRuntimeScript();
    await mounting;
    expect(module.callMain).toHaveBeenCalledOnce();
    expect(runtime.getState()).toBe("RUNNING");
    await runtime.exit();
  });

  it("rejects a project index with ambiguous case-insensitive paths", async () => {
    const body = JSON.stringify({
      schemaVersion: 1,
      files: [
        { path: "0.txt", sizeBytes: 1, sha256: "a".repeat(64), mediaType: "application/octet-stream", url: "https://content.example/0.txt" },
        { path: "0.TXT", sizeBytes: 1, sha256: "a".repeat(64), mediaType: "application/octet-stream", url: "https://content.example/0.TXT" },
        { path: "default.ttf", sizeBytes: 1, sha256: "a".repeat(64), mediaType: "application/octet-stream", url: "https://content.example/default.ttf" },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const runtime = await createRuntime(config(), currentWindowHost(null));
    await expect(runtime.mount(document.createElement("div"))).rejects.toThrow("ONS_PROJECT_INDEX_INVALID");
  });
});
