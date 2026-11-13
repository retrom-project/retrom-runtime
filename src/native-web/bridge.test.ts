import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type BridgeEvent = {
  data: unknown;
  origin: string;
  source?: unknown;
  ports: FakePort[];
  stopImmediatePropagation: () => void;
};

type FakePort = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown) => void;
  start: () => void;
};

describe("native-web RPG Maker bridge", () => {
  it("reports readiness without fixture-variable proofs and applies video modes inside the isolated frame", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "assets/runtime/native/bridge.js"),
      "utf8",
    );
    const listeners = new Map<string, Array<(event: BridgeEvent) => void>>();
    const replies: unknown[] = [];
    const nativeExit = vi.fn();
    const setImageRendering = vi.fn();
    const sceneManager = { _scene: null, exit: nativeExit, run: () => undefined, updateMain: () => undefined };
    const runtime = {
      location: {href: "https://runtime.example/game/www/index.html"},
      DataManager: {}, localStorage, Scene_Boot: class {start() {}},
      document: {querySelectorAll: () => [{style: {setProperty: setImageRendering}}]},
      SceneManager: sceneManager,
      StorageManager: {},
      Utils: { RPGMAKER_NAME: "MV" },
      addEventListener: (name: string, callback: (event: BridgeEvent) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), callback]);
      },
      parent: { postMessage: () => undefined },
      requestAnimationFrame: () => 1,
    };
    runInNewContext(source, { URL, TextDecoder, TextEncoder, performance, window: runtime });
    const port: FakePort = {
      onmessage: null,
      postMessage: (message) => replies.push(message),
      start: () => undefined,
    };

    listeners.get("message")?.[0]?.({
      data: {
        launchId: "01980000-0000-7000-8000-000000000001",
        nonce: "test-nonce",
        parentOrigin: "https://host.example",
        profile: "RPGMV",
        protocolVersion: 1,
        type: "RPG_RUNTIME_NATIVE_CONNECT", saves: null, pluginFiles: [],
      },
      origin: "https://host.example", source: runtime.parent,
      ports: [port],
      stopImmediatePropagation: () => undefined,
    });
    listeners.get("load")?.forEach(listener => listener({target: runtime.document} as unknown as BridgeEvent));
    sceneManager.run(); await new Promise(resolve => setTimeout(resolve, 0));
    sceneManager.updateMain();

    expect(replies).toContainEqual({
      body: {
        engine: "RPGMV",
        engineProfile: "RPGMV",
      },
      launchId: "01980000-0000-7000-8000-000000000001",
      nonce: "test-nonce",
      protocolVersion: 1,
      requestId: 0,
      type: "READY",
    });

    port.onmessage?.({data: {
      body: {mode: "pixel"},
      launchId: "01980000-0000-7000-8000-000000000001",
      nonce: "test-nonce",
      protocolVersion: 1,
      requestId: 1,
      type: "SET_VIDEO_MODE",
    }});
    await vi.waitFor(() => expect(replies).toContainEqual(expect.objectContaining({
      requestId: 1, type: "SET_VIDEO_MODE_RESULT",
    })));
    expect(setImageRendering).toHaveBeenCalledWith("image-rendering", "pixelated", "important");

    sceneManager.exit();
    sceneManager.exit();
    expect(nativeExit).toHaveBeenCalledTimes(2);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replies.filter((reply) => (reply as {type?: string}).type === "EXIT_REQUESTED")).toEqual([{
      body: {},
      launchId: "01980000-0000-7000-8000-000000000001",
      nonce: "test-nonce",
      protocolVersion: 1,
      requestId: 0,
      type: "EXIT_REQUESTED",
    }]);
  });

  it("preserves CanvasTextAlign semantics and does not wait for keepalive cleanup", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "assets/runtime/native/bridge.js"),
      "utf8",
    );
    const listeners = new Map<string, Array<(event: BridgeEvent) => void>>();
    const replies: unknown[] = [];
    const alignments = new WeakMap<object, string>();
    const nativeTextAlignSetter = vi.fn(function setTextAlign(this: object, value: string) {
      alignments.set(this, value);
    });
    class FakeCanvasRenderingContext2D {}
    Object.defineProperty(FakeCanvasRenderingContext2D.prototype, "textAlign", {
      configurable: true,
      get(this: object) {return alignments.get(this) ?? "start";},
      set: nativeTextAlignSetter,
    });
    const fetcher = vi.fn();
    const runtime = {
      location: {href: "https://runtime.example/game/www/index.html"},
      CanvasRenderingContext2D: FakeCanvasRenderingContext2D,
      addEventListener: (name: string, callback: (event: BridgeEvent) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), callback]);
      },
      fetch: fetcher,

      parent: {postMessage: () => undefined},
      requestAnimationFrame: () => 1,
    };
    runInNewContext(source, {TextDecoder, TextEncoder, URL, window: runtime});
    const port: FakePort = {
      onmessage: null,
      postMessage: (message) => replies.push(message),
      start: () => undefined,
    };
    const launchId = "01980000-0000-7000-8000-000000000001";
    const nonce = "test-nonce";
    listeners.get("message")?.[0]?.({
      data: {
        launchId, nonce, parentOrigin: "https://host.example", profile: "RPGMV",
        protocolVersion: 1, type: "RPG_RUNTIME_NATIVE_CONNECT", saves: null, pluginFiles: [],
      },
      origin: "https://host.example", source: runtime.parent,
      ports: [port],
      stopImmediatePropagation: () => undefined,
    });

    const context = new FakeCanvasRenderingContext2D() as FakeCanvasRenderingContext2D & {textAlign: string};
    context.textAlign = "center";
    context.textAlign = undefined as unknown as string;
    expect(context.textAlign).toBe("center");
    expect(nativeTextAlignSetter).toHaveBeenCalledTimes(1);
    expect(nativeTextAlignSetter).toHaveBeenCalledWith("center");

    port.onmessage?.({data: {
      body: {}, launchId, nonce, protocolVersion: 1, requestId: 1, type: "CLEANUP",
    }});
    expect(fetcher).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(replies).toContainEqual(expect.objectContaining({
      requestId: 1, type: "CLEANUP_RESULT",
    })));
  });

});
