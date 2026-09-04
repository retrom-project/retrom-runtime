import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeKirikiriCheckpoint, encodeKirikiriCheckpoint } from "./checkpoint.js";
import type { KirikiriRuntimeConfig } from "./contract.js";
import { createRuntime } from "../index.js";

type FakeModule = {
  onExit?: (status: number) => void;
  postRun: Array<() => void>;
  pauseMainLoop: ReturnType<typeof vi.fn>;
  resumeMainLoop: ReturnType<typeof vi.fn>;
  _krkr2_host_bookmark_is_ready: ReturnType<typeof vi.fn>;
  _krkr2_host_load_bookmark: ReturnType<typeof vi.fn>;
  _krkr2_host_load_bookmark_state: ReturnType<typeof vi.fn>;
  _krkr2_host_save_bookmark: ReturnType<typeof vi.fn>;
  _startupXp3Path?: string;
  [key: string]: unknown;
};
type FakeVlfs = ReturnType<typeof fakeVlfs>;
type HostWindow = Window & { Module?: Partial<FakeModule>; VLFS?: FakeVlfs };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, "getGamepads");
  delete (window as HostWindow).Module;
  delete (window as HostWindow).VLFS;
  document.body.replaceChildren();
  document.head.querySelectorAll("script[data-runtime=kirikiri2]").forEach((script) => script.remove());
});

describe("KiriKiri2 KAG runtime", () => {
  const runtimeTerminationCases: ReadonlyArray<readonly [string, "error" | "unhandledrejection"]> = [
    "null function",
    "function signature mismatch",
    "null function or function signature mismatch",
    "table index is out of bounds",
  ].flatMap((message) => (["error", "unhandledrejection"] as const)
    .map((transport) => [message, transport] as const));

  it.each(runtimeTerminationCases)(
    "turns the KiriKiri wasm %s termination from %s into one runtime exit",
    async (terminationMessage, transport) => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const runtime = createRuntime(config(), { frameWindow: window, restorePayload: null });
    const events: string[] = [];
    runtime.subscribe((event) => events.push(event.type));
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    await loadCore(vlfs);
    await mounting;
    const unrelated = new WebAssembly.RuntimeError("null function");
    Object.defineProperty(unrelated, "stack", { value: "RuntimeError: null function\n at app.ts:1:1" });

    expect(window.dispatchEvent(runtimeFailureEvent(transport, unrelated))).toBe(true);
    expect(runtime.getState()).toBe("RUNNING");

    const actualCrash = new WebAssembly.RuntimeError("unreachable");
    Object.defineProperty(actualCrash, "stack", {
      value: "RuntimeError: unreachable\n" +
        " at https://runtime.example/kirikiri/index.wasm:wasm-function[3000]:0x1334f5",
    });
    expect(window.dispatchEvent(runtimeFailureEvent(transport, actualCrash))).toBe(true);
    expect(runtime.getState()).toBe("RUNNING");

    const termination = new WebAssembly.RuntimeError(terminationMessage);
    Object.defineProperty(termination, "stack", {
      value: `RuntimeError: ${terminationMessage}\n` +
        " at https://runtime.example/kirikiri/index.wasm:wasm-function[1852]:0x90236",
    });
    expect(window.dispatchEvent(runtimeFailureEvent(transport, termination))).toBe(false);

    await vi.waitFor(() => expect(runtime.getState()).toBe("EXITED"));
    expect(events.filter((type) => type === "EXIT_REQUESTED")).toHaveLength(1);
    },
  );

  it("finishes a fresh mount at core postRun before the first stable KAG save point", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const runtime = createRuntime(config(), { frameWindow: window, restorePayload: null });
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs, { bookmarkReady: 0 });

    const outcome = await Promise.race([
      mounting.then(() => "mounted"),
      new Promise<string>((resolve) => setTimeout(() => resolve("still-waiting"), 25)),
    ]);
    expect(runtime.getCheckpointAvailability()).toEqual({ available: false, blocker: "NOT_READY" });
    module._krkr2_host_bookmark_is_ready.mockReturnValue(1);
    await mounting;

    expect(outcome).toBe("mounted");
    expect(runtime.getCheckpointAvailability()).toEqual({ available: true, blocker: null });
    await runtime.exit();
  });

  it("reports the engine process exit and makes checkpointing unavailable", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const runtime = createRuntime(config(), { frameWindow: window, restorePayload: null });
    const events: string[] = [];
    runtime.subscribe((event) => events.push(event.type));
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs);
    await mounting;

    module.onExit?.(0);

    await vi.waitFor(() => expect(runtime.getState()).toBe("EXITED"));
    expect(events.filter((type) => type === "EXIT_REQUESTED")).toHaveLength(1);
    expect(runtime.getCheckpointAvailability()).toEqual({ available: false, blocker: "NOT_READY" });
  });

  it("does not carry startup input into the ready runtime", async () => {
    enableRuntimeFeatures();
    const animationFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const buttons = Array.from({ length: 16 }, () => gamepadButton());
    buttons[0] = gamepadButton(true);
    Object.defineProperty(window.navigator, "getGamepads", {
      configurable: true,
      value: vi.fn(() => [{ axes: [0, 0], buttons, connected: true, mapping: "standard" }]),
    });
    const vlfs = fakeVlfs();
    mockDownloads();
    const target = document.createElement("div");
    document.body.append(target);
    const runtime = createRuntime(config(), { frameWindow: window, restorePayload: null });
    const mounting = runtime.mount(target);
    const canvas = target.querySelector("canvas");
    if (!canvas) {throw new Error("test canvas missing");}
    const inputs: string[] = [];
    canvas.addEventListener("mousedown", () => inputs.push("mousedown"));
    canvas.addEventListener("click", () => inputs.push("click"));
    canvas.addEventListener("keydown", () => inputs.push("keydown"));

    animationFrames.shift()?.(0);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true }));

    expect(inputs).toEqual([]);
    await loadVlfs(vlfs);
    await loadCore(vlfs);
    await mounting;
    animationFrames.shift()?.(16);
    buttons[0] = gamepadButton();
    animationFrames.shift()?.(32);
    expect(inputs).toEqual([]);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true }));
    buttons[0] = gamepadButton(true);
    animationFrames.shift()?.(48);
    buttons[0] = gamepadButton();
    animationFrames.shift()?.(64);
    expect(inputs).toEqual(["keydown", "mousedown", "click"]);
    await runtime.exit();
  });

  it("maps standard gamepad directions and face buttons to KiriKiri mouse input", async () => {
    enableRuntimeFeatures();
    const animationFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const axes = [0, 0];
    const buttons = Array.from({ length: 16 }, () => gamepadButton());
    Object.defineProperty(window.navigator, "getGamepads", {
      configurable: true,
      value: vi.fn(() => [{ axes, buttons, connected: true, mapping: "standard" }]),
    });
    const vlfs = fakeVlfs();
    mockDownloads();
    const target = document.createElement("div");
    document.body.append(target);
    const runtime = createRuntime(config(), { frameWindow: window, restorePayload: null });
    const mounting = runtime.mount(target);
    await loadVlfs(vlfs);
    await loadCore(vlfs);
    await mounting;
    const canvas = target.querySelector("canvas");
    if (!canvas) {throw new Error("test canvas missing");}
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(domRect(100, 50, 800, 600));
    const inputs: string[] = [];
    for (const type of ["mousemove", "mousedown", "mouseup", "click", "contextmenu"]) {
      canvas.addEventListener(type, (event) => {
        const mouse = event as MouseEvent;
        inputs.push(`${type}:${mouse.button}:${Math.round(mouse.clientX)}:${Math.round(mouse.clientY)}`);
      });
    }

    animationFrames.shift()?.(0);
    axes[0] = 0.75;
    animationFrames.shift()?.(100);
    axes[0] = 0;
    animationFrames.shift()?.(116);
    buttons[0] = gamepadButton(true);
    animationFrames.shift()?.(132);
    buttons[0] = gamepadButton();
    animationFrames.shift()?.(148);
    buttons[1] = gamepadButton(true);
    animationFrames.shift()?.(164);
    buttons[1] = gamepadButton();
    animationFrames.shift()?.(180);

    expect(inputs.some((value) => value.startsWith("mousemove:0:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("mousedown:0:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("mouseup:0:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("click:0:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("mousedown:2:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("mouseup:2:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("contextmenu:2:"))).toBe(true);
    const cursor = target.querySelector<HTMLElement>("[data-kirikiri-gamepad-cursor]");
    expect(cursor?.hidden).toBe(false);
    expect(cursor?.style.transform).toContain("translate");
    await runtime.exit();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("mounts, focuses, creates a small semantic checkpoint and restores it", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const target = document.createElement("div");
    document.body.append(target);
    const runtime = createRuntime(config(), { frameWindow: window, restorePayload: null });
    const mounting = runtime.mount(target);
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs);
    await mounting;

    expect(module._startupXp3Path).toBe("/data.xp3");
    expect(vlfs.registerRemote).toHaveBeenCalledWith(
      "/data.xp3",
      `https://content.example/runtime/content/project/${"a".repeat(64)}/data.xp3`,
      1234,
      true,
    );
    expect(vlfs.registerRemote).toHaveBeenCalledWith(
      "/startup.tjs",
      `https://content.example/runtime/content/project/${"a".repeat(64)}/startup.tjs`,
      40,
      true,
    );
    expect(document.activeElement).toBe(target.querySelector("canvas"));
    expect(target.firstElementChild?.getAttribute("data-kirikiri-runtime-surface")).toBe("");
    module._krkr2_host_bookmark_is_ready.mockReturnValue(0);
    expect(runtime.getCheckpointAvailability()).toEqual({ available: false, blocker: "NOT_READY" });
    await expect(runtime.checkpoint()).rejects.toThrow("CHECKPOINT_UNAVAILABLE");
    expect(module.pauseMainLoop).not.toHaveBeenCalled();
    expect(module._krkr2_host_save_bookmark).not.toHaveBeenCalled();
    module._krkr2_host_bookmark_is_ready.mockReturnValue(1);
    const checkpoint = await runtime.checkpoint();
    expect(checkpoint.format).toBe("kirikiri-save-bundle-v1");
    expect(checkpoint.bytes.byteLength).toBeLessThan(1024);
    expect(module._krkr2_host_save_bookmark).toHaveBeenCalledWith(1999);
    expect(module._krkr2_host_save_bookmark).toHaveBeenCalledBefore(module.pauseMainLoop);
    expect(module.resumeMainLoop).toHaveBeenCalledAfter(module._krkr2_host_save_bookmark);
    expect((await decodeKirikiriCheckpoint(checkpoint.bytes)).entries.map((entry) => entry.path)).toEqual([
      "savedata/data1999.ksd", "savedata/datasu.ksd",
    ]);
    await runtime.exit();
    expect(target.childElementCount).toBe(0);
    expect(document.head.querySelector("script[data-runtime=kirikiri2]")).toBeNull();

    const restoredVlfs = fakeVlfs();
    const restored = createRuntime(config(), { frameWindow: window, restorePayload: checkpoint.bytes });
    const restoredTarget = document.createElement("div");
    const restoredMount = restored.mount(restoredTarget);
    await loadVlfs(restoredVlfs);
    const restoredModule = await loadCore(restoredVlfs, { restoreState: 1 });
    let mountCompleted = false;
    void restoredMount.then(() => {
      mountCompleted = true;
    });
    await vi.waitFor(() =>
      expect(restoredModule._krkr2_host_load_bookmark).toHaveBeenCalledWith(1999),
    );
    expect(mountCompleted).toBe(false);
    restoredModule._krkr2_host_bookmark_is_ready.mockReturnValue(0);
    restoredModule._krkr2_host_load_bookmark_state.mockReturnValue(2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mountCompleted).toBe(false);
    restoredModule._krkr2_host_bookmark_is_ready.mockReturnValue(1);
    await restoredMount;
    expect(restoredVlfs.registerOverlayFile).toHaveBeenCalledWith(
      "/savedata/data1999.ksd", Uint8Array.of(1, 9, 9, 9),
    );
    expect(restoredModule._krkr2_host_load_bookmark).toHaveBeenCalledWith(1999);
    await restored.exit();
  });

  it("temporarily resumes a paused core until a custom bookmark file is written", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const runtime = createRuntime(config(), { frameWindow: window, restorePayload: null });
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs);
    await mounting;
    await runtime.pause();
    module.pauseMainLoop.mockClear();
    module.resumeMainLoop.mockClear();
    module._krkr2_host_save_bookmark.mockImplementation(() => {
      queueMicrotask(() => {
        vlfs.onWriteClose?.("/savedata/custom-host-bookmark.bmp", Uint8Array.of(4, 2));
      });
      return 0;
    });

    const checkpoint = await runtime.checkpoint();

    expect(module.resumeMainLoop).toHaveBeenCalledBefore(module._krkr2_host_save_bookmark);
    expect(module.pauseMainLoop).toHaveBeenCalledAfter(module._krkr2_host_save_bookmark);
    expect((await decodeKirikiriCheckpoint(checkpoint.bytes)).entries).toContainEqual({
      path: "savedata/custom-host-bookmark.bmp", data: Uint8Array.of(4, 2),
    });
    await runtime.exit();
  });

  it("resumes a paused core before waiting for the next stable KAG save point", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const runtime = createRuntime(config(), { frameWindow: window, restorePayload: null });
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs);
    await mounting;
    await runtime.pause();
    let ready = false;
    let availabilityRead = false;
    module._krkr2_host_bookmark_is_ready.mockImplementation(() => {
      if (!availabilityRead) {availabilityRead = true; return 1;}
      return ready ? 1 : 0;
    });
    module.resumeMainLoop.mockImplementation(() => {ready = true;});
    module._krkr2_host_bookmark_is_ready.mockClear();
    module.pauseMainLoop.mockClear();
    module.resumeMainLoop.mockClear();
    vi.useFakeTimers();
    try {
      const checkpointPromise = runtime.checkpoint();
      await vi.advanceTimersByTimeAsync(60_100);
      await checkpointPromise;
      expect(module.resumeMainLoop.mock.invocationCallOrder[0]).toBeLessThan(
        module._krkr2_host_bookmark_is_ready.mock.invocationCallOrder[1]!,
      );
      expect(module._krkr2_host_save_bookmark).toHaveBeenCalledWith(1999);
      expect(module.pauseMainLoop).toHaveBeenCalledAfter(module._krkr2_host_save_bookmark);
    } finally {
      vi.useRealTimers();
      await runtime.exit();
    }
  });

  it("rejects a restore when the KAG bookmark API rejects the slot", async () => {
    enableRuntimeFeatures();
    const restore = await encodeKirikiriCheckpoint({
      entries: [{ path: "savedata/data1999.ksd", data: Uint8Array.of(1) }],
      resumeSlot: 1999,
    });
    const vlfs = fakeVlfs();
    mockDownloads();
    const runtime = createRuntime(config(), { frameWindow: window, restorePayload: restore });
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const rejected = expect(mounting).rejects.toThrow("KIRIKIRI_CHECKPOINT_RESTORE_FAILED");
    await loadCore(vlfs, { restoreResult: -4 });
    await rejected;
  });

  it("fails closed when multiple XP3 files have no selected entry", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads(["/data.xp3", "/patch.xp3"]);
    const runtime = createRuntime(config(), { frameWindow: window, restorePayload: null });
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    await expect(mounting).rejects.toThrow("KIRIKIRI_PROJECT_ENTRY_AMBIGUOUS");
  });
});

function runtimeFailureEvent(transport: "error" | "unhandledrejection", error: WebAssembly.RuntimeError) {
  if (transport === "error") {
    return new ErrorEvent("error", { cancelable: true, error, message: error.message });
  }
  const event = new Event("unhandledrejection", { cancelable: true });
  Object.defineProperty(event, "reason", { value: error });
  return event;
}

function gamepadButton(pressed = false): GamepadButton {
  return { pressed, touched: pressed, value: pressed ? 1 : 0 };
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height, height, left, right: left + width, top, width, x: left, y: top,
    toJSON: () => ({}),
  };
}

function config(): KirikiriRuntimeConfig {
  return {
    sessionId: "kirikiri-session",
    adapter: {
      adapterKind: "KIRIKIRI2_WEB",
      adapterId: "kirikiri2-web",
      checkpointSlot: 1999,
      projectIndexUrl: "https://content.example/project/index.json",
      runtimeBaseUrl: "https://runtime.example/kirikiri/",
      startupXp3Path: null,
    },
  };
}

function enableRuntimeFeatures() {
  Object.defineProperty(window, "crossOriginIsolated", { configurable: true, value: true });
  Object.defineProperty(window, "SharedArrayBuffer", { configurable: true, value: SharedArrayBuffer });
  Object.defineProperty(window.WebAssembly, "Suspending", { configurable: true, value: function Suspending() {} });
  Object.defineProperty(window.WebAssembly, "promising", { configurable: true, value: function promising() {} });
}

function mockDownloads(xp3Paths = ["/data.xp3"]) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("assets.zip")) {return new Response(Uint8Array.of(1), { status: 200 });}
    if (url.endsWith("project/index.json") && !init?.method) {
      return Response.json({ schemaVersion: 1, files: [
        ...xp3Paths.map((path) => ({
          path: path.replace(/^\//u, ""), sizeBytes: 1234,
          url: `/runtime/content/project/${"a".repeat(64)}${path}`,
        })),
        {
          path: "startup.tjs", sizeBytes: 40,
          url: `/runtime/content/project/${"a".repeat(64)}/startup.tjs`,
        },
      ] });
    }
    throw new Error(`unexpected request: ${url}`);
  }));
}

function fakeVlfs() {
  const value = {
    init: vi.fn(async () => undefined),
    mkdir: vi.fn(() => 0),
    onWriteClose: null as ((path: string, data: Uint8Array) => void) | null,
    registerOverlayFile: vi.fn(),
    registerRemote: vi.fn(),
    registerZipBlob: vi.fn(async () => ({ paths: ["/ui/font.ttf"], xp3Paths: [] as string[] })),
  };
  return value;
}

async function loadVlfs(vlfs: FakeVlfs) {
  await vi.waitFor(() => expect(runtimeScripts()).toHaveLength(1));
  (window as HostWindow).VLFS = vlfs;
  runtimeScripts()[0]!.dispatchEvent(new Event("load"));
}

async function loadCore(
  vlfs: FakeVlfs,
  options: { bookmarkReady?: number; restoreResult?: number; restoreState?: number } = {},
) {
  await vi.waitFor(() => expect(runtimeScripts()).toHaveLength(2));
  const configured = (window as HostWindow).Module ?? {};
  const module = Object.assign(configured, {
    pauseMainLoop: vi.fn(),
    resumeMainLoop: vi.fn(),
    _krkr2_host_bookmark_is_ready: vi.fn(() => options.bookmarkReady ?? 1),
    _krkr2_host_load_bookmark: vi.fn(() => options.restoreResult ?? 0),
    _krkr2_host_load_bookmark_state: vi.fn(() => options.restoreState ?? 2),
    _krkr2_host_save_bookmark: vi.fn((slot: number) => {
      vlfs.onWriteClose?.(`/savedata/data${slot}.ksd`, Uint8Array.of(1, 9, 9, 9));
      vlfs.onWriteClose?.("/savedata/datasu.ksd", Uint8Array.of(2, 8));
      return 0;
    }),
  }) as FakeModule;
  (window as HostWindow).Module = module;
  runtimeScripts()[1]!.dispatchEvent(new Event("load"));
  module.postRun[0]?.();
  return module;
}

function runtimeScripts() {
  return [...document.head.querySelectorAll<HTMLScriptElement>("script[data-runtime=kirikiri2]")];
}
