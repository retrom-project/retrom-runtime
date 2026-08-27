import { afterEach, describe, expect, it, vi } from "vitest";

import type { OnsRuntimeConfig } from "./contract.js";
import { decodeOnsCheckpoint, encodeOnsCheckpoint } from "./checkpoint.js";
import { createOnsRuntime } from "./index.js";

type HostWindow = Window & {
  onsyuri?: (options: Record<string, unknown>) => Promise<FakeModule>;
  onsyuriHostReady?: () => void;
  scale_full?: (element: HTMLElement, ratio: number) => void;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as HostWindow).onsyuri;
  delete (window as HostWindow).onsyuriHostReady;
  document.head.querySelectorAll("script[data-runtime=ons-yuri]").forEach((script) => script.remove());
  document.body.replaceChildren();
});

describe("ONS Yuri runtime", () => {
  it("mounts the tagged core, accepts keyboard focus and checkpoints the reserved slot", async () => {
    const module = fakeModule();
    const factory = vi.fn(async (options: Record<string, unknown>) => {
      Object.assign(options, module);
      const configured = options as FakeModule;
      configured.preRun?.();
      expect(typeof (window as HostWindow).scale_full).toBe("function");
      const canvas = document.querySelector<HTMLCanvasElement>("canvas");
      if (!canvas) {throw new Error("test canvas missing");}
      (window as HostWindow).scale_full?.(canvas, 4 / 3);
      expect(canvas.style.width).not.toBe("");
      return configured;
    });
    (window as HostWindow).onsyuri = factory;
    mockIndex();
    const target = document.createElement("div");
    document.body.append(target);
    const runtime = createOnsRuntime(config(), { frameWindow: window, restorePayload: null });
    const mounting = runtime.mount(target);
    await loadRuntimeScript();
    await mounting;

    expect(module.callMain).toHaveBeenCalledWith([
      "--root", "/game", "--font", "/game/default.ttf", "--save-dir", "/save", "--enc:utf8",
    ]);
    expect(runtime.getCheckpointAvailability()).toEqual({ available: true, reason: null });
    target.querySelector("canvas")?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.activeElement).toBe(target.querySelector("canvas"));

    const checkpoint = await runtime.checkpoint();
    expect(checkpoint.payloadKind).toBe("ONS_SAVE_BUNDLE_V1");
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
    expect(target.childElementCount).toBe(0);
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
    const runtime = createOnsRuntime(config(), { frameWindow: window, restorePayload: restore });
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
    const runtime = createOnsRuntime(config(), { frameWindow: window, restorePayload: restore });
    const mounting = runtime.mount(document.createElement("div"));
    const rejected = expect(mounting).rejects.toThrow("ONS_CHECKPOINT_RESTORE_FAILED");
    await loadRuntimeScript();
    await rejected;
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
        { path: "0.txt", url: "/runtime/projects/preview/0.txt" },
        { path: "default.ttf", url: "/runtime/projects/preview/default.ttf" },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const runtime = createOnsRuntime(config(), { frameWindow: window, restorePayload: null });
    const mounting = runtime.mount(document.createElement("div"));
    await loadRuntimeScript();
    await mounting;
    await runtime.exit();
  });

  it("rejects a project index with ambiguous case-insensitive paths", async () => {
    const body = JSON.stringify({
      schemaVersion: 1,
      title: "fixture",
      fontPath: "default.ttf",
      files: [
        { path: "0.txt", url: "https://content.example/0.txt" },
        { path: "0.TXT", url: "https://content.example/0.TXT" },
        { path: "default.ttf", url: "https://content.example/default.ttf" },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const runtime = createOnsRuntime(config(), { frameWindow: window, restorePayload: null });
    await expect(runtime.mount(document.createElement("div"))).rejects.toThrow("ONS_PROJECT_INDEX_INVALID");
  });
});

async function loadRuntimeScript() {
  await vi.waitFor(() => expect(document.head.querySelector("script[data-runtime=ons-yuri]")).not.toBeNull());
  document.head.querySelector<HTMLScriptElement>("script[data-runtime=ons-yuri]")?.dispatchEvent(new Event("load"));
}

function config(): OnsRuntimeConfig {
  return {
    sessionId: "runtime-session",
    adapter: {
      adapterKind: "ONS_YURI_WEB",
      adapterId: "ons-yuri-web",
      checkpointSlot: 999,
      projectIndexUrl: "https://content.example/index.json",
      runtimeBaseUrl: "https://runtime.example/ons/",
      scriptEncoding: "utf8",
    },
  };
}

function mockIndex() {
  const body = JSON.stringify({
    schemaVersion: 1,
    title: "fixture",
    fontPath: "default.ttf",
    files: [
      { path: "0.txt", url: "https://content.example/0.txt" },
      { path: "default.ttf", url: "https://content.example/default.ttf" },
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
  preRun?: () => void;
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
