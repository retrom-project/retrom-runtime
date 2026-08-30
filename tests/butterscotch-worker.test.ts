import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

type WorkerMessage = { code?: string; type?: string };
type WorkerStart = { canvas: { height: number; id?: string; width: number }; moduleUrl: string };

describe("Butterscotch worker asset", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__butterscotchWorkerFactory;
    vi.unstubAllGlobals();
  });

  it("assigns the Emscripten canvas identity before the core creates its WebGL context", async () => {
    let messageListener: ((event: { data: WorkerStart & { type: "START" } }) => void) | undefined;
    const messages: WorkerMessage[] = [];
    const fakeRuntime = {
      GL: { offscreenCanvases: {} as Record<string, unknown> },
      HEAP32: new Int32Array(16), HEAPU32: new Uint32Array(16),
      _malloc: () => 4, _mountOpfs: () => 0, _setAudioSampleRate: () => undefined,
      ccall: () => {
        const registered = fakeRuntime.GL.offscreenCanvases.canvas as { offscreenCanvas?: { id?: string } };
        if (registered?.offscreenCanvas?.id !== "canvas") {throw new Error("canvas identity missing");}
        (globalThis.postMessage as (message: WorkerMessage) => void)({ type: "runnerReady" });
      },
    };
    vi.stubGlobal("self", {
      addEventListener: (_type: string, listener: typeof messageListener) => {messageListener = listener;},
    });
    vi.stubGlobal("postMessage", (message: WorkerMessage) => messages.push(message));
    vi.stubGlobal("setInterval", () => 1);
    (globalThis as Record<string, unknown>).__butterscotchWorkerFactory = async () => fakeRuntime;
    const moduleUrl = "data:text/javascript,export default (...args) => globalThis.__butterscotchWorkerFactory(...args)";
    const source = await readFile(resolve("assets/runtime/butterscotch/worker.mjs"), "utf8");
    await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const canvas: WorkerStart["canvas"] = { height: 480, width: 640 };

    messageListener?.({ data: {
      audioEnabled: false, audioSampleRate: 48_000, canvas, gamePath: "/game/data.win",
      moduleUrl, restore: false, savePath: "/saves/game", type: "START", wasmUrl: "/runtime.wasm",
    } as WorkerStart & { type: "START" } });
    await vi.waitFor(() => expect(messages).toContainEqual({ type: "runnerReady" }));

    expect(canvas.id).toBe("canvas");
    expect(messages).not.toContainEqual(expect.objectContaining({ type: "FATAL" }));
  });
});
