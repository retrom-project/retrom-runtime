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
      HEAPU8: new Uint8Array(new SharedArrayBuffer(262208)),
      _getContentReadSlot: () => 0, _registerContentFile: () => 0,
      _setGamepads: () => undefined,
      _malloc: () => 4, _mountOpfs: () => 0, _setAudioSampleRate: () => undefined,
      ccall: (name: string) => {
        if (name === "registerContentFile") {return 0;}
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
      files: [{id: 0, path: "/game/data.win", sizeBytes: 1024}],
    } as WorkerStart & { type: "START" } });
    await vi.waitFor(() => expect(messages).toContainEqual({ type: "runnerReady" }));

    expect(canvas.id).toBe("canvas");
    expect(messages).toContainEqual({type: "CONTENT_READY", buffer: fakeRuntime.HEAPU8.buffer, offset: 0});
    expect(messages).not.toContainEqual(expect.objectContaining({ type: "FATAL" }));
  });

  it("publishes both controllers as one frame and clears only a disconnected slot", async () => {
    let receive!: (event: {data: Record<string, unknown>}) => void;
    const heap = new ArrayBuffer(4096);
    const connected = Array(4).fill(0);
    const observed: number[][] = [];
    const atomic = vi.fn((pointer: number, count: number) => {
      const frame = new Float32Array(heap, pointer, count * 22);
      observed.push([...frame]);
    });
    const runtime = {
      GL: {offscreenCanvases: {}}, HEAP32: new Int32Array(heap), HEAPU32: new Uint32Array(heap),
      HEAPU8: new Uint8Array(heap), HEAPF32: new Float32Array(heap),
      _getContentReadSlot: () => 0, _registerContentFile: () => 0,
      _malloc: vi.fn(() => 128), _free: vi.fn(), _setAudioSampleRate: () => undefined,
      ccall: vi.fn(() => 0), _setGamepads: atomic,
      // Model the runner sampling between any two legacy host calls.
      _setGamepadConnected: (slot: number, value: number) => {
        connected[slot] = value; observed.push([...connected]);
      },
      _setGamepadButton: () => undefined, _setGamepadAxis: () => undefined,
    };
    vi.stubGlobal("self", {addEventListener: (_type: string, listener: typeof receive) => {receive = listener;}});
    vi.stubGlobal("postMessage", vi.fn());
    vi.stubGlobal("setInterval", () => 1);
    (globalThis as Record<string, unknown>).__butterscotchWorkerFactory = async () => runtime;
    const source = await readFile(resolve("assets/runtime/butterscotch/worker.mjs"), "utf8");
    await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#gamepads`);
    receive({data: {type: "START", canvas: {width: 640, height: 480}, files: [], audioEnabled: false,
      moduleUrl: "data:text/javascript,export default (...args) => globalThis.__butterscotchWorkerFactory(...args)"}});
    await vi.waitFor(() => expect(runtime.ccall).toHaveBeenCalled());
    const first = {axes: [0.5, -0.25], buttons: [1]};
    const second = {axes: [-0.75, 1], buttons: [0, 1]};
    receive({data: {type: "GAMEPAD", gamepads: [first, second]}});
    expect(observed).toHaveLength(1);
    expect(observed[0][0]).toBe(1); expect(observed[0][22]).toBe(1);
    expect(observed[0][1]).toBe(1); expect(observed[0][24]).toBe(1);
    expect(observed[0][18]).toBe(0.5); expect(observed[0][40]).toBe(-0.75);
    receive({data: {type: "GAMEPAD", gamepads: [null, second]}});
    expect(observed[1].slice(0, 22)).toEqual(Array(22).fill(0));
    expect(observed[1].slice(22, 44)).toEqual(observed[0].slice(22, 44));
    receive({data: {type: "GAMEPAD", gamepads: []}});
    expect(observed[2]).toEqual(Array(88).fill(0));
  });
});
