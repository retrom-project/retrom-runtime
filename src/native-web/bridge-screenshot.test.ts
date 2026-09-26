import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {describe, expect, it, vi} from "vitest";

type BridgeEvent = {
  data: unknown;
  origin: string;
  ports: FakePort[];
  stopImmediatePropagation: () => void;
};

type FakePort = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown) => void;
  start: () => void;
};

describe("native-web RPG Maker screenshot bridge", () => {
  it("renders a native screenshot from the current scene instead of the discarded WebGL canvas", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "assets/runtime/native/bridge.js"),
      "utf8",
    );
    const listeners = new Map<string, Array<(event: BridgeEvent) => void>>();
    const replies: unknown[] = [];
    const renderedPng = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1);
    const destroy = vi.fn();
    let snapAttempt = 0;
    const snap = vi.fn(() => ({
      canvas: {
        toBlob: (callback: BlobCallback, mediaType: string) => {
          snapAttempt += 1;
          callback(snapAttempt <= 3 ? null : new Blob([renderedPng], {type: mediaType}));
        },
      },
      destroy,
    }));
    const animationFrames: FrameRequestCallback[] = [];
    const runtime = {
      Bitmap: {snap},
      SceneManager: {_scene: {marker: "visible-scene"}, updateMain: () => undefined},
      document: {
        querySelector: () => ({
          toBlob: (callback: BlobCallback) => callback(new Blob([Uint8Array.of(0)], {type: "image/png"})),
        }),
      },
      addEventListener: (name: string, callback: (event: BridgeEvent) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), callback]);
      },
      parent: {postMessage: () => undefined},
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      },
    };
    runInNewContext(source, {Blob, TextDecoder, TextEncoder, window: runtime});
    const port: FakePort = {
      onmessage: null,
      postMessage: (message) => replies.push(message),
      start: () => undefined,
    };
    const launchId = "01980000-0000-7000-8000-000000000001";
    const nonce = "test-nonce";
    listeners.get("message")?.[0]?.({
      data: {cleanupUrl: null, launchId, nonce, parentOrigin: "https://host.example", profile: "RPGMV", protocolVersion: 1, type: "RPG_RUNTIME_NATIVE_CONNECT"},
      origin: "https://host.example",
      ports: [port],
      stopImmediatePropagation: () => undefined,
    });

    port.onmessage?.({data: {body: {}, launchId, nonce, protocolVersion: 1, requestId: 1, type: "SCREENSHOT"}});
    expect(snap).not.toHaveBeenCalled();
    animationFrames.shift()?.(0);
    await vi.waitFor(() => expect(animationFrames).toHaveLength(1));
    animationFrames.shift()?.(16);
    await vi.waitFor(() => expect(animationFrames).toHaveLength(1));
    animationFrames.shift()?.(32);
    await vi.waitFor(() => expect(animationFrames).toHaveLength(1));
    animationFrames.shift()?.(48);
    await vi.waitFor(() => expect(replies).toContainEqual(expect.objectContaining({type: "SCREENSHOT_RESULT"})));
    const reply = replies.find((value) => (value as {type?: string}).type === "SCREENSHOT_RESULT") as {
      body: {data: ArrayBuffer; mediaType: string};
    };
    expect([...new Uint8Array(reply.body.data)]).toEqual([...renderedPng]);
    expect(reply.body.mediaType).toBe("image/png");
    expect(snap).toHaveBeenCalledTimes(4);
    expect(snap).toHaveBeenCalledWith(runtime.SceneManager._scene);
    expect(destroy).toHaveBeenCalledTimes(4);
  });
});
