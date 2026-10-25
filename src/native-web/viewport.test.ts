import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {describe, expect, it, vi} from "vitest";

function fixture(engine: "MV" | "MZ") {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const replies: Array<{type: string}> = [];
  const graphics = {
    _canvas: null as object | null,
    _stretchEnabled: false,
    _defaultStretchMode: () => false,
    _updateAllElements: vi.fn(),
    initialize: vi.fn(function initialize() {
      graphics._stretchEnabled = graphics._defaultStretchMode();
      graphics._canvas = {};
      graphics._updateAllElements();
    }),
  };
  const runtime = {
    Graphics: graphics,
    Utils: {RPGMAKER_NAME: engine},
    Scene_Boot: class {start() {}},
    SceneManager: {updateMain() {}},
    DataManager: {}, StorageManager: {}, document: {},
    location: {href: "https://game.test/run/id/index.html"},
    parent: {postMessage() {}},
    requestAnimationFrame() {},
    addEventListener(name: string, listener: (event: unknown) => void) {
      listeners.set(name, [...listeners.get(name) ?? [], listener]);
    },
    removeEventListener() {},
  };
  runInNewContext(readFileSync("assets/runtime/native/bridge.js", "utf8"),
    {URL, TextEncoder, TextDecoder, window: runtime});
  const identity = {launchId: "viewport-fixture", nonce: "nonce", protocolVersion: 1};
  const port = {
    onmessage: null as null | ((event: {data: unknown}) => void),
    start() {}, postMessage(message: {type: string}) {replies.push(message);},
  };
  const dispatch = (type: string, event: unknown) => listeners.get(type)?.forEach(listener => listener(event));
  dispatch("message", {
    source: runtime.parent, origin: "https://host.test", ports: [port], stopImmediatePropagation() {},
    data: {...identity, parentOrigin: "https://host.test", profile: `RPG${engine}`,
      type: "RPG_RUNTIME_NATIVE_CONNECT", pluginFiles: []},
  });
  return {
    graphics,
    load: () => dispatch("load", {target: runtime.document}),
    loadImage: () => dispatch("load", {target: {}}),
    async cleanup() {
      port.onmessage?.({data: {...identity, type: "CLEANUP", requestId: 1, body: {}}});
      await vi.waitFor(() => expect(replies).toContainEqual(expect.objectContaining({type: "CLEANUP_RESULT"})));
    },
  };
}

describe.each(["MV", "MZ"] as const)("RPG Maker %s viewport", engine => {
  it("defaults to fitting the viewport when the engine initializes after window load", () => {
    const {graphics, load, loadImage} = fixture(engine);
    const originalDefault = graphics._defaultStretchMode;
    loadImage();
    expect(graphics._defaultStretchMode).toBe(originalDefault);

    load();
    expect(graphics._updateAllElements).not.toHaveBeenCalled();
    expect(graphics.initialize).not.toHaveBeenCalled();
    graphics.initialize();

    expect(graphics._stretchEnabled).toBe(true);
    expect(graphics._updateAllElements).toHaveBeenCalledOnce();
  });

  it("refits a canvas initialized early by a plugin without initializing the engine again", () => {
    const {graphics, load} = fixture(engine);
    graphics.initialize();
    const canvas = graphics._canvas;
    graphics._updateAllElements.mockClear();
    load();

    expect(graphics._stretchEnabled).toBe(true);
    expect(graphics._updateAllElements).toHaveBeenCalledOnce();
    expect(graphics.initialize).toHaveBeenCalledOnce();
    expect(graphics._canvas).toBe(canvas);
  });

  it("restores the engine's viewport behavior on cleanup", async () => {
    const {graphics, load, cleanup} = fixture(engine);
    const originalDefault = graphics._defaultStretchMode;
    load();
    graphics.initialize();
    expect(graphics._stretchEnabled).toBe(true);

    await cleanup();

    expect(graphics._defaultStretchMode).toBe(originalDefault);
    expect(graphics._stretchEnabled).toBe(false);
    expect(graphics._updateAllElements).toHaveBeenCalledTimes(2);
  });
});
