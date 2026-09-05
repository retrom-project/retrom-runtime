import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountWasm4, type Wasm4CoreModule } from "./adapter.js";
import type {Wasm4Parameters} from "./parameters.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("WASM-4 Web adapter", () => {
  it("loads and verifies the cart, restores in a fresh core, and delegates the complete lifecycle", async () => {
    const cart = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
    const digest = await sha256(cart);
    const restore = Uint8Array.of(82, 84, 87, 52, 83, 49, 0, 0, 1);
    const target = document.createElement("div");
    document.body.append(target);
    const canvas = document.createElement("canvas");
    const checkpoint = Uint8Array.from({length: 64}, (_value, index) => index);
    const core = fakeCore(canvas, checkpoint);
    const loader = vi.fn(async () => core.module);
    const runtimeConfig = config(digest, cart.byteLength);
    runtimeConfig.runtimeBaseUrl = "/runtime/wasm4/";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(cart.slice(), {
      headers: {"content-length": String(cart.byteLength)}, status: 200,
    })));
    const progress = vi.fn();

    const adapter = await mountWasm4(
      runtimeConfig, target, window, restore, progress, loader, async () => digest,
    );

    expect(loader).toHaveBeenCalledWith(
      new URL("/runtime/wasm4/wasm4-retrom.mjs", window.location.href).href, window,
    );
    expect(core.create).toHaveBeenCalledWith({
      cartBytes: cart,
      contentDigest: digest,
      restorePayload: restore,
      target,
    });
    expect(progress).toHaveBeenLastCalledWith({
      loadedBytes: cart.byteLength, phase: "PROJECT_CONTENT", totalBytes: cart.byteLength,
    });
    await expect(adapter.checkpoint()).resolves.toEqual({bytes: checkpoint, format: "wasm4-state-v1"});
    await adapter.pause();
    await adapter.resume();
    await expect(adapter.screenshot()).resolves.toEqual(expect.objectContaining({type: "image/png"}));
    expect(adapter.getCanvas()).toBe(canvas);
    expect(adapter.getFrameCount()).toBe(42);
    expect(adapter.getCheckpointAvailability()).toEqual({available: true, blocker: null});

    await adapter.exit();
    await adapter.exit();
    expect(core.stop).toHaveBeenCalledTimes(1);
    expect(adapter.getCheckpointAvailability()).toEqual({available: false, blocker: "NOT_READY"});
    await expect(adapter.checkpoint()).rejects.toThrow("WASM4_RUNTIME_INVALID_STATE");
  });

  it("fails closed on a cart digest mismatch before starting third-party code", async () => {
    const cart = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
    const core = fakeCore(document.createElement("canvas"), Uint8Array.of(1));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(cart.slice(), {status: 200})));

    await expect(mountWasm4(
      config("f".repeat(64), cart.byteLength), document.createElement("div"), window, null,
      () => undefined, async () => core.module, async () => sha256(cart),
    )).rejects.toThrow("WASM4_CART_DIGEST_MISMATCH");
    expect(core.create).not.toHaveBeenCalled();
  });

  it("rejects an incompatible module ABI and an oversized checkpoint", async () => {
    const cart = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
    const digest = await sha256(cart);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(cart.slice(), {status: 200})));
    const incompatible = fakeCore(document.createElement("canvas"), Uint8Array.of(1));
    incompatible.module.RETROM_WASM4_ADAPTER_ABI = "unknown";
    await expect(mountWasm4(
      config(digest, cart.byteLength), document.createElement("div"), window, null,
      () => undefined, async () => incompatible.module, async () => digest,
    )).rejects.toThrow("WASM4_CORE_ABI_MISMATCH");

    const oversized = fakeCore(
      document.createElement("canvas"), new Uint8Array(132145),
    );
    const adapter = await mountWasm4(
      config(digest, cart.byteLength), document.createElement("div"), window, null,
      () => undefined, async () => oversized.module, async () => digest,
    );
    await expect(adapter.checkpoint()).rejects.toThrow("WASM4_CHECKPOINT_CREATE_FAILED");
    await adapter.exit();
  });

  it("preserves a stable error code thrown by a core in another JavaScript realm", async () => {
    const cart = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
    const digest = await sha256(cart);
    const core = fakeCore(document.createElement("canvas"), Uint8Array.of(1));
    core.module.createRetromWasm4 = vi.fn(async () => {
      throw {message: "WASM4_CHECKPOINT_RESTORE_FAILED"};
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(cart.slice(), {status: 200})));

    await expect(mountWasm4(
      config(digest, cart.byteLength), document.createElement("div"), window, null,
      () => undefined, async () => core.module, async () => digest,
    )).rejects.toThrow("WASM4_CHECKPOINT_RESTORE_FAILED");
  });
});

function fakeCore(canvas: HTMLCanvasElement, checkpoint: Uint8Array) {
  const stop = vi.fn(async () => undefined);
  const create = vi.fn(async () => ({
    canvas,
    checkpoint: () => checkpoint,
    frameCount: () => 42,
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => new Blob([Uint8Array.of(137, 80, 78, 71)], {type: "image/png"})),
    stop,
  }));
  const module: Wasm4CoreModule = {
    RETROM_WASM4_ADAPTER_ABI: "wasm4-state-v1",
    RETROM_WASM4_CHECKPOINT_MAX_BYTES: 132144,
    createRetromWasm4: create,
  };
  return {create, module, stop};
}

function config(contentDigest: string, cartSizeBytes: number): Wasm4Parameters {
  return {
    contentDigest,
    cartSizeBytes,
    cartUrl: "https://content.example/cart.wasm",
    runtimeBaseUrl: "https://runtime.example/wasm4/",
  };
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
