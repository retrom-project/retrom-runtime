import { afterEach, describe, expect, it, vi } from "vitest";

import {targetEnvelope} from "../../tests/provider-fixtures.js";
import {currentWindowHost} from "../../tests/provider-adapter-fixture.js";
import { decodeOnsCheckpoint, encodeOnsCheckpoint } from "./checkpoint.js";
import { createRuntime } from "../index.js";

type HostWindow = Window & {
  fetch_file?: (fileSystem: FakeFs, path: string) => Promise<number>;
  onsyuri?: (options: Record<string, unknown>) => Promise<FakeModule>;
  onsyuriHostReady?: () => void;
  scale_full?: (element: HTMLElement, ratio: number) => void;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, "getGamepads");
  delete (window as HostWindow).onsyuri;
  delete (window as HostWindow).onsyuriHostReady;
  delete (window as HostWindow).fetch_file;
  document.head.querySelectorAll("script[data-runtime=ons-yuri]").forEach((script) => script.remove());
  document.body.replaceChildren();
});

describe("ONS Yuri runtime", () => {
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

  it("persists immutable project files across runtime instances and reports aggregate loading progress", async () => {
    const projectFiles = [
      { path: "0.txt", bytes: Uint8Array.of(1) },
      { path: "default.ttf", bytes: Uint8Array.of(2, 3) },
      { path: "arc.nsa", bytes: Uint8Array.of(4, 5, 6, 7) },
    ];
    const indexBody = JSON.stringify({
      schemaVersion: 1,
      title: "fixture",
      fontPath: "default.ttf",
      files: projectFiles.map(({ path, bytes }) => ({
        path,
        sizeBytes: bytes.byteLength,
        url: `https://content.example/${path}`,
      })),
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.endsWith("/index.json")) {return new Response(indexBody, { status: 200 });}
      const file = projectFiles.find(({ path }) => url.endsWith(`/${path}`));
      if (!file) {return new Response(null, { status: 404 });}
      return new Response(file.bytes.slice(), {
        headers: { "content-length": String(file.bytes.byteLength) },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("caches", new MemoryCacheStorage());

    for (let run = 0; run < 2; run += 1) {
      const module = fakeModule();
      (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
        Object.assign(options, module);
        const configured = options as FakeModule;
        configured.preRun?.();
        for (const file of projectFiles) {
          expect(await (window as HostWindow).fetch_file?.(configured.FS, `/game/${file.path}`)).toBe(1);
        }
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
        loadedBytes: 7, totalBytes: 7, type: "LOAD_PROGRESS",
      });
      await runtime.exit();
    }

    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input)).filter((url) => !url.endsWith("/index.json")))
      .toEqual(projectFiles.map(({ path }) => `https://content.example/${path}`));
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

  it("mounts the tagged core, accepts keyboard focus and checkpoints the reserved slot", async () => {
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
    expect(runtime.getCheckpointAvailability()).toEqual({ available: true, reason: null });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(document.querySelector("#game")!.firstElementChild?.getAttribute("data-ons-runtime-surface")).toBe("");
    expect((document.querySelector("#game")!.firstElementChild as HTMLElement).style.display).toBe("grid");
    expect((document.querySelector("#game")!.firstElementChild as HTMLElement).style.placeItems).toBe("center");
    expect(document.activeElement).toBe(document.querySelector("#game")!.querySelector("canvas"));
    document.querySelector("#game")!.querySelector("canvas")?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.activeElement).toBe(document.querySelector("#game")!.querySelector("canvas"));

    const checkpoint = await runtime.checkpoint();
    expect(checkpoint.format).toBe("ons-save-bundle-v1");
    const decoded = await decodeOnsCheckpoint(checkpoint.bytes);
    expect(decoded.resumeSlot).toBe(999);
    expect(decoded.entries.map((entry) => entry.path)).toContain("save999.dat");
    expect(module._onsyuri_host_save).toHaveBeenCalledWith(999);
    expect(module._onsyuri_host_set_paused).toHaveBeenNthCalledWith(1, 1);
    expect(module._onsyuri_host_set_paused).toHaveBeenLastCalledWith(0);
    const [pauseOrder, resumeOrder] = module._onsyuri_host_set_paused.mock.invocationCallOrder;
    const [saveOrder] = module._onsyuri_host_save.mock.invocationCallOrder;
    expect(pauseOrder).toBeLessThan(saveOrder!);
    expect(resumeOrder).toBeGreaterThan(saveOrder!);

    await runtime.exit();
    expect(document.querySelector("#game")).toBeNull();
    expect(document.head.querySelector("script[data-runtime=ons-yuri]")).toBeNull();
  });

  it("writes restore bytes and selects the startup slot before the engine starts", async () => {
    const restore = await encodeOnsCheckpoint({
      entries: [{ path: "save999.dat", data: Uint8Array.of(8, 6, 7, 5) }],
      resumeSlot: 999,
    });
    const module = fakeModule();
    (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      expect(configured.FS.readFile("/save/save999.dat")).toBeInstanceOf(Uint8Array);
      return configured;
    });
    mockIndex();
    const target = document.createElement("div");
    document.body.append(target);
    const runtime = await createRuntime(config(), currentWindowHost(restore));
    const mounting = runtime.mount(target);
    await loadRuntimeScript();
    await mounting;

    expect(module._onsyuri_host_set_restore_slot).toHaveBeenCalledWith(999);
    expect(module._onsyuri_host_set_restore_slot).toHaveBeenCalledBefore(module.callMain);
    await runtime.exit();
  });

  it("rejects startup when the core cannot load the prepared restore slot", async () => {
    const restore = await encodeOnsCheckpoint({
      entries: [{ path: "save999.dat", data: Uint8Array.of(1, 2, 3) }],
      resumeSlot: 999,
    });
    const module = fakeModule();
    module._onsyuri_host_did_restore_fail.mockReturnValue(1);
    (window as HostWindow).onsyuri = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      return configured;
    });
    mockIndex();
    const runtime = await createRuntime(config(), currentWindowHost(restore));
    const mounting = runtime.mount(document.createElement("div"));
    const rejected = expect(mounting).rejects.toThrow("ONS_CHECKPOINT_RESTORE_FAILED");
    await loadRuntimeScript();
    await rejected;
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
      title: "fixture",
      fontPath: "default.ttf",
      files: [
        { path: "0.txt", sizeBytes: 1, url: "https://content.example/0.txt" },
        { path: "default.ttf", sizeBytes: 1, url: "https://content.example/default.ttf" },
        { path: "movie/intro.mp4", sizeBytes: 50_000_000, url: "https://content.example/movie/intro.mp4" },
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
      title: "fixture",
      fontPath: "default.ttf",
      files: [
        { path: "0.txt", sizeBytes: 1, url: `/runtime/content/project/${"a".repeat(64)}/0.txt` },
        { path: "default.ttf", sizeBytes: 1, url: `/runtime/content/project/${"a".repeat(64)}/default.ttf` },
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

  it("rejects a project index with ambiguous case-insensitive paths", async () => {
    const body = JSON.stringify({
      schemaVersion: 1,
      title: "fixture",
      fontPath: "default.ttf",
      files: [
        { path: "0.txt", sizeBytes: 1, url: "https://content.example/0.txt" },
        { path: "0.TXT", sizeBytes: 1, url: "https://content.example/0.TXT" },
        { path: "default.ttf", sizeBytes: 1, url: "https://content.example/default.ttf" },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const runtime = await createRuntime(config(), currentWindowHost(null));
    await expect(runtime.mount(document.createElement("div"))).rejects.toThrow("ONS_PROJECT_INDEX_INVALID");
  });
});

async function loadRuntimeScript() {
  await vi.waitFor(() => expect(document.head.querySelector("script[data-runtime=ons-yuri]")).not.toBeNull());
  document.head.querySelector<HTMLScriptElement>("script[data-runtime=ons-yuri]")?.dispatchEvent(new Event("load"));
}

function config() {return targetEnvelope("onscripter-yuri");}

function mockIndex() {
  const body = JSON.stringify({
    schemaVersion: 1,
    title: "fixture",
    fontPath: "default.ttf",
    files: [
      { path: "0.txt", sizeBytes: 1, url: "https://content.example/0.txt" },
      { path: "default.ttf", sizeBytes: 1, url: "https://content.example/default.ttf" },
    ],
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
}

function fakeModule(): FakeModule {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const FS = new FakeFs();
  const module: FakeModule = {
    FS,
    callMain: vi.fn(() => {window.setTimeout(() => (window as HostWindow).onsyuriHostReady?.(), 0);}),
    _onsyuri_host_load: vi.fn(() => 0),
    _onsyuri_host_did_restore_fail: vi.fn(() => 0),
    _onsyuri_host_is_ready: vi.fn(() => 1),
    _onsyuri_host_save: vi.fn((slot: number) => {
      FS.writeFile(`/save/save${slot}.dat`, Uint8Array.of(1, 2, 3));
      return 0;
    }),
    _onsyuri_host_set_paused: vi.fn(),
    _onsyuri_host_set_restore_slot: vi.fn(),
  };
  return module;
}

type FakeModule = {
  FS: FakeFs;
  callMain: ReturnType<typeof vi.fn>;
  onExit?: (status: number) => void;
  preRun?: () => void;
  printErr?: (message: string) => void;
  _onsyuri_host_load: ReturnType<typeof vi.fn>;
  _onsyuri_host_did_restore_fail: ReturnType<typeof vi.fn>;
  _onsyuri_host_is_ready: ReturnType<typeof vi.fn>;
  _onsyuri_host_save: ReturnType<typeof vi.fn>;
  _onsyuri_host_set_paused: ReturnType<typeof vi.fn>;
  _onsyuri_host_set_restore_slot: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
};

class FakeFs {
  private readonly directories = new Set(["/"]);
  private readonly files = new Map<string, Uint8Array>();

  mkdirTree(path: string) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {current += `/${part}`; this.directories.add(current);}
  }

  writeFile(path: string, bytes: Uint8Array) {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (!this.directories.has(parent)) {throw new Error("ENOENT");}
    this.files.set(path, bytes.slice());
  }

  readFile(path: string) {
    const value = this.files.get(path);
    if (!value) {throw new Error("ENOENT");}
    return value.slice();
  }

  readdir(path: string) {
    const prefix = path === "/" ? "/" : `${path}/`;
    const names = new Set([".", ".."]);
    for (const item of [...this.directories, ...this.files.keys()]) {
      if (!item.startsWith(prefix)) {continue;}
      const name = item.slice(prefix.length).split("/")[0];
      if (name) {names.add(name);}
    }
    return [...names];
  }

  stat(path: string) {
    if (this.directories.has(path)) {return { mode: 16384 };}
    if (this.files.has(path)) {return { mode: 32768 };}
    throw new Error("ENOENT");
  }

  isDir(mode: number) {return mode === 16384;}
  unlink(path: string) {this.files.delete(path);}
}

class MemoryCacheStorage {
  private readonly cache = new MemoryCache();

  async open() {return this.cache;}
}

class MemoryCache {
  private readonly responses = new Map<string, Response>();

  async delete(request: RequestInfo | URL) {return this.responses.delete(requestUrl(request));}
  async match(request: RequestInfo | URL) {return this.responses.get(requestUrl(request))?.clone();}
  async put(request: RequestInfo | URL, response: Response) {
    this.responses.set(requestUrl(request), response.clone());
  }
}

function requestUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : String(input);
}
