import { afterEach, describe, expect, it, vi } from "vitest";

import { mountButterscotch } from "./adapter.js";
import type { ButterscotchRuntimeConfig } from "./contract.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  Reflect.deleteProperty(window.navigator, "getGamepads");
});

describe("Butterscotch Web adapter", () => {
  it("mounts cached project bytes, restores, maps input and creates a bounded core checkpoint", async () => {
    installIsolatedBrowserGlobals();
    const workers: FakeWorker[] = [];
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: class extends FakeWorker {constructor(url: URL) {super(url); workers.push(this);}},
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
      configurable: true,
      value() {return { height: this.height, width: this.width };},
    });
    Object.defineProperty(window.navigator, "storage", {
      configurable: true, value: { getDirectory: async () => new MemoryDirectory() },
    });
    const animationFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const gamepad = { axes: [0.75, 0], buttons: [{ pressed: true, value: 1 }], connected: true, mapping: "standard" };
    Object.defineProperty(window.navigator, "getGamepads", { configurable: true, value: () => [gamepad] });
    mockProject();
    const target = document.createElement("div");
    document.body.append(target);
    const restore = Uint8Array.of(66, 83, 67, 80, 2, 0, 0, 0, 0, 0, 0, 0);

    const adapter = await mountButterscotch(config(), target, window, restore, () => undefined, () => undefined);
    const canvas = adapter.getCanvas();
    if (!canvas) {throw new Error("test canvas missing");}
    canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "ArrowUp" }));
    animationFrames.shift()?.(16);
    const checkpoint = await adapter.checkpoint();
    await expect(adapter.screenshot()).resolves.toEqual(expect.objectContaining({type: "image/png"}));

    expect(checkpoint).toEqual({
      bytes: Uint8Array.of(66, 83, 67, 80, 2, 0, 0, 0, 4, 0, 0, 0, 1, 2, 3, 4),
      format: "butterscotch-checkpoint-v2",
    });
    expect(workers[0]?.commands).toContain("RESTORE");
    expect(workers[0]?.url.pathname).toBe("/runtime/retrom-runtime/v0.8.0/butterscotch-worker.mjs");
    expect(workers[0]?.messages).toContainEqual(expect.objectContaining({ keyCode: 38, pressed: true, type: "KEY" }));
    expect(workers[0]?.messages).toContainEqual(expect.objectContaining({ type: "GAMEPAD" }));
    expect(adapter.getCheckpointAvailability()).toEqual({ available: true, blocker: null });
    expect(document.activeElement).toBe(canvas);

    await adapter.exit();
    expect(workers[0]?.terminated).toBe(true);
    expect(target.childElementCount).toBe(0);
  });

  it("reports a core-owned exit once and disables checkpointing", async () => {
    installIsolatedBrowserGlobals();
    const workers: FakeWorker[] = [];
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: class extends FakeWorker {constructor(url: URL) {super(url); workers.push(this);}},
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
      configurable: true, value: () => ({ height: 480, width: 640 }),
    });
    Object.defineProperty(window.navigator, "storage", {
      configurable: true, value: { getDirectory: async () => new MemoryDirectory() },
    });
    mockProject();
    const exits = vi.fn();
    const adapter = await mountButterscotch(
      config(), document.createElement("div"), window, null, () => undefined, exits,
    );
    const worker = workers[0];

    worker?.emit({ type: "runnerExit" });
    worker?.emit({ type: "runnerExit" });

    expect(exits).toHaveBeenCalledTimes(1);
    expect(adapter.getCheckpointAvailability()).toEqual({ available: false, blocker: "NOT_READY" });
    await expect(adapter.checkpoint()).rejects.toThrow("BUTTERSCOTCH_RUNTIME_INVALID_STATE");
    await adapter.exit();
  });

  it("distinguishes transient startup work from an unsupported core checkpoint shape", async () => {
    installIsolatedBrowserGlobals();
    const workers: FakeWorker[] = [];
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: class extends FakeWorker {constructor(url: URL) {super(url, 1); workers.push(this);}},
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
      configurable: true, value: () => ({ height: 480, width: 640 }),
    });
    Object.defineProperty(window.navigator, "storage", {
      configurable: true, value: { getDirectory: async () => new MemoryDirectory() },
    });
    mockProject();
    const adapter = await mountButterscotch(
      config(), document.createElement("div"), window, null, () => undefined, () => undefined,
    );

    expect(adapter.getCheckpointAvailability()).toEqual({ available: false, blocker: "BUSY" });
    workers[0]?.emit({ available: false, status: 5, type: "checkpointAvailability" });
    expect(adapter.getCheckpointAvailability()).toEqual({ available: false, blocker: "UNSUPPORTED" });
    workers[0]?.emit({ available: true, status: 0, type: "checkpointAvailability" });
    expect(adapter.getCheckpointAvailability()).toEqual({ available: true, blocker: null });
    await adapter.exit();
  });
});

class FakeWorker extends EventTarget {
  readonly messages: Array<Record<string, unknown>> = [];
  readonly commands: string[] = [];
  terminated = false;
  constructor(readonly url: URL, private readonly initialStatus = 0) {super();}
  postMessage(message: Record<string, unknown>) {
    this.messages.push(message);
    if (message.type === "START") {
      queueMicrotask(() => {
        this.emit({ type: "runnerReady" });
        this.emit({ available: this.initialStatus === 0, status: this.initialStatus, type: "checkpointAvailability" });
      });
      return;
    }
    if (message.type !== "HOST_COMMAND") {return;}
    const command = String(message.command);
    this.commands.push(command);
    const response: Record<string, unknown> = {
      command, ok: true, requestId: message.requestId, type: "HOST_RESPONSE",
    };
    if (command === "STATUS") {
      response.available = this.initialStatus === 0;
      response.status = this.initialStatus;
    }
    if (command === "CHECKPOINT") {
      response.bytes = Uint8Array.of(66, 83, 67, 80, 2, 0, 0, 0, 4, 0, 0, 0, 1, 2, 3, 4);
    }
    if (command === "SCREENSHOT") {response.bytes = Uint8Array.of(137, 80, 78, 71);}
    queueMicrotask(() => this.emit(response));
  }
  terminate() {this.terminated = true;}
  emit(data: Record<string, unknown>) {this.dispatchEvent(new MessageEvent("message", { data }));}
}

class MemoryDirectory {
  private readonly directories = new Map<string, MemoryDirectory>();
  private readonly files = new Map<string, Uint8Array>();
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const found = this.directories.get(name);
    if (found) {return found;}
    if (!options?.create) {throw new DOMException("missing", "NotFoundError");}
    const value = new MemoryDirectory();
    this.directories.set(name, value);
    return value;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) {throw new DOMException("missing", "NotFoundError");}
    return {
      createWritable: async () => ({
        abort: async () => {this.files.delete(name);},
        close: async () => undefined,
        write: async (bytes: Uint8Array) => {this.files.set(name, new Uint8Array(bytes));},
      }),
      getFile: async () => new File([new Uint8Array(this.files.get(name) ?? [])], name),
    };
  }
  async removeEntry(name: string) {this.files.delete(name);}
}

function config(): ButterscotchRuntimeConfig {
  return {
    sessionId: "launch-1",
    contentDigest: "c".repeat(64),
    adapter: {
      adapterKind: "BUTTERSCOTCH_WEB",
      adapterId: "butterscotch-web",
      projectIndexUrl: "https://content.example/index.json",
      runtimeBaseUrl: "/runtime/retrom-runtime/v0.8.0/",
    },
  };
}

function mockProject() {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("index.json")) {
      return new Response(JSON.stringify({
        files: [{ path: "data.win", sizeBytes: 4, url: "https://content.example/data.win" }],
        schemaVersion: 1,
      }));
    }
    return new Response(Uint8Array.of(1, 2, 3, 4));
  }));
}

function installIsolatedBrowserGlobals() {
  Object.defineProperty(window, "crossOriginIsolated", { configurable: true, value: true });
  Object.defineProperty(window, "SharedArrayBuffer", { configurable: true, value: globalThis.SharedArrayBuffer });
}
