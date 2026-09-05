import { afterEach, describe, expect, it, vi } from "vitest";
import { rpgMakerPositionProbeKind, type RpgMakerRuntimeConfig } from "../rpgmaker/contract";
import { mountEasyRpg } from "./adapter";
import { encodeRpgCheckpoint } from "../checkpoint";

type EasyConfig = RpgMakerRuntimeConfig & {
  adapter: Extract<RpgMakerRuntimeConfig["adapter"], { adapterKind: "EASYRPG_WEB" }>;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as Window & { createEasyRpgPlayer?: unknown }).createEasyRpgPlayer;
  Object.defineProperty(window, "createImageBitmap", { configurable: true, value: undefined });
  document.head.querySelectorAll("script[data-rpg-runtime=easyrpg]").forEach((script) => script.remove());
  document.body.replaceChildren();
});

describe("EasyRPG adapter cleanup", () => {
  it("waits for the restored map before exposing a mounted runtime or position probe", async () => {
    const payload = await encodeRpgCheckpoint({
      engine: "RPG2003", resumeSlot: 100,
      entries: [{store: "FILESYSTEM", key: "Save/Save100.lsd", mediaType: "application/octet-stream", data: new Uint8Array([1])}],
    });
    const target = document.createElement("div");
    document.body.append(target);
    const readRuntimeState = vi.fn()
      .mockReturnValueOnce(JSON.stringify({engine: "RPG2003", ready: false, canCheckpoint: false,
        frameCount: 10, mapId: 0, playerX: 0, playerY: 0, fixtureState: 0}))
      .mockReturnValue(JSON.stringify({engine: "RPG2003", ready: true, canCheckpoint: true,
        frameCount: 20, mapId: 7, playerX: 4, playerY: 6, fixtureState: 9}));
    const createPlayer = vi.fn().mockResolvedValue({
      FS: {}, canvas: document.createElement("canvas"), runtimeFileSystemReady: true,
      initApi: vi.fn(), pauseMainLoop: vi.fn(), resumeMainLoop: vi.fn(),
      api: {runtimeState: readRuntimeState},
    });
    Object.defineProperty(window, "createEasyRpgPlayer", {configurable: true, value: createPlayer});
    const mounting = mountEasyRpg(easyConfig("RPG2003"), target, window, payload);
    await vi.waitFor(() => expect(document.head.querySelector("script[data-rpg-runtime=easyrpg]")).not.toBeNull());
    document.head.querySelector("script[data-rpg-runtime=easyrpg]")?.dispatchEvent(new Event("load"));
    const mounted = await mounting;
    expect(createPlayer).toHaveBeenCalledWith(expect.objectContaining({runtimeRestoreSlot: 100}));
    expect(readRuntimeState).toHaveBeenCalledTimes(2);
    expect(mounted.getValidationProbe(rpgMakerPositionProbeKind)?.value)
      .toEqual({mapId: 7, playerX: 4, playerY: 6, fixtureState: 9});
    await mounted.exit();
  });

  it.each([false, true])("does not treat loading frames as a final engine identity (persistent mismatch: %s)", async (persistent) => {
    vi.useFakeTimers();
    const target = document.createElement("div");
    document.body.append(target);
    let initialized = false;
    Object.defineProperty(window, "createEasyRpgPlayer", {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        FS: {}, canvas: document.createElement("canvas"), runtimeFileSystemReady: true,
        initApi: vi.fn(), pauseMainLoop: vi.fn(), resumeMainLoop: vi.fn(),
        api: {runtimeState: () => JSON.stringify({
          engine: initialized ? "RPG2003" : "RPG2000", ready: false, canCheckpoint: false,
          frameCount: 10, mapId: 0, playerX: 0, playerY: 0, fixtureState: 0,
        })},
      }),
    });
    let settled = false;
    const mounting = mountEasyRpg(easyConfig("RPG2003"), target, window, null)
      .then((value) => {settled = true; return value;}, (error: unknown) => {settled = true; return error;});
    await vi.advanceTimersByTimeAsync(0);
    const script = document.head.querySelector("script[data-rpg-runtime=easyrpg]");
    expect(script).not.toBeNull();
    script?.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    initialized = !persistent;
    await vi.advanceTimersByTimeAsync(persistent ? 30_000 : 50);
    const result = await mounting;
    if (persistent) {
      expect(result).toEqual(new Error("RPG_ENGINE_PROFILE_MISMATCH"));
      expect(target.childElementCount).toBe(0);
    } else {
      expect(result).toHaveProperty("getFrameCount");
    }
  });

  it("removes the mount DOM and failed loader before rejecting", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const mounting = mountEasyRpg(easyConfig(), target, window, null);
    await vi.waitFor(() => expect(document.head.querySelector("script[data-rpg-runtime=easyrpg]")).not.toBeNull());
    const script = document.head.querySelector<HTMLScriptElement>("script[data-rpg-runtime=easyrpg]");
    expect(script).not.toBeNull();
    script?.dispatchEvent(new Event("error"));

    await expect(mounting).rejects.toThrow("RPG_RUNTIME_ARTIFACT_UNAVAILABLE");
    expect(target.childElementCount).toBe(0);
    expect(document.head.querySelector("script[data-rpg-runtime=easyrpg]")).toBeNull();
    target.remove();
  });

  it("rejects a runtime that resolves before its persistent filesystem is ready", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const canvas = document.createElement("canvas");
    Object.defineProperty(window, "createEasyRpgPlayer", {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        FS: {}, api: { runtimeState: () => "{}" }, canvas,
        runtimeFileSystemReady: false, initApi: vi.fn(), pauseMainLoop: vi.fn(), resumeMainLoop: vi.fn(),
      }),
    });
    const mounting = mountEasyRpg(easyConfig(), target, window, null);
    await vi.waitFor(() => expect(document.head.querySelector("script[data-rpg-runtime=easyrpg]")).not.toBeNull());
    document.head.querySelector<HTMLScriptElement>("script[data-rpg-runtime=easyrpg]")
      ?.dispatchEvent(new Event("load"));

    await expect(mounting).rejects.toThrow("RPG_RUNTIME_FILESYSTEM_NOT_READY");
    expect(target.childElementCount).toBe(0);
    expect(document.head.querySelector("script[data-rpg-runtime=easyrpg]")).toBeNull();
    delete (window as Window & { createEasyRpgPlayer?: unknown }).createEasyRpgPlayer;
    target.remove();
  });

  it("starts the current release after its persistent filesystem is ready", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const canvas = document.createElement("canvas");
    const createPlayer = vi.fn().mockResolvedValue({
      FS: {},
      api: {
        createRuntimeCheckpoint: vi.fn(),
        runtimeState: () => JSON.stringify({
          engine: "RPG2000", ready: true, canCheckpoint: true,
          frameCount: 1, mapId: 1, playerX: 8, playerY: 6, fixtureState: 0,
        }),
      },
      canvas, runtimeFileSystemReady: true, initApi: vi.fn(), pauseMainLoop: vi.fn(), resumeMainLoop: vi.fn(),
    });
    Object.defineProperty(window, "createEasyRpgPlayer", {
      configurable: true,
      value: createPlayer,
    });
    const config = easyConfig();
    const reportExitRequested = vi.fn();
    const mounting = mountEasyRpg(config, target, window, null, reportExitRequested);
    await vi.waitFor(() => expect(document.head.querySelector("script[data-rpg-runtime=easyrpg]")).not.toBeNull());
    document.head.querySelector<HTMLScriptElement>("script[data-rpg-runtime=easyrpg]")
      ?.dispatchEvent(new Event("load"));

    const mounted = await mounting;
    expect(createPlayer).toHaveBeenCalledWith(expect.objectContaining({
      noExitRuntime: true,
      onRuntimeExitRequested: expect.any(Function),
      runtimeProjectRootUrl: config.adapter.projectRootUrl,
    }));
    const options = createPlayer.mock.calls[0]?.[0] as {onRuntimeExitRequested?: () => void};
    options.onRuntimeExitRequested?.();
    expect(reportExitRequested).toHaveBeenCalledOnce();
    expect(mounted.getValidationProbe(rpgMakerPositionProbeKind)?.value)
      .toEqual({ mapId: 1, playerX: 8, playerY: 6, fixtureState: 0 });
    await mounted.exit();
    delete (window as Window & { createEasyRpgPlayer?: unknown }).createEasyRpgPlayer;
    target.remove();
  });

  it("mounts on an interactive title scene without exposing map position evidence", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const canvas = document.createElement("canvas");
    Object.defineProperty(window, "createEasyRpgPlayer", {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        FS: {},
        api: {
          createRuntimeCheckpoint: vi.fn(),
          runtimeState: () => JSON.stringify({
            engine: "RPG2003", ready: false, canCheckpoint: false,
            frameCount: 120, mapId: 0, playerX: 0, playerY: 0, fixtureState: 0,
          }),
        },
        canvas, runtimeFileSystemReady: true,
        initApi: vi.fn(), pauseMainLoop: vi.fn(), resumeMainLoop: vi.fn(),
      }),
    });
    const mounting = mountEasyRpg(easyConfig("RPG2003"), target, window, null);
    await vi.waitFor(() => expect(document.head.querySelector("script[data-rpg-runtime=easyrpg]")).not.toBeNull());
    document.head.querySelector<HTMLScriptElement>("script[data-rpg-runtime=easyrpg]")
      ?.dispatchEvent(new Event("load"));

    const mounted = await mounting;
    expect(mounted.getFrameCount()).toBe(120);
    expect(mounted.getValidationProbe(rpgMakerPositionProbeKind)).toBeNull();
    expect(mounted.getCheckpointAvailability()).toEqual({available: false, blocker: "BUSY"});
    await mounted.exit();
    target.remove();
  });

  it("passes an RTP file tree to the core without downloading RTP payload files", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const canvas = document.createElement("canvas");
    const indexUrl = new URL("/runtime/rtp/index.json", window.location.href).href;
    const response = new Response(JSON.stringify({
      schemaVersion: 1,
      files: [
        { path: "CharSet/Hero.PNG", sizeBytes: 41, url: "/runtime/rtp/CharSet/Hero.PNG" },
        { path: "ExFont.png", sizeBytes: 42, url: "/runtime/rtp/ExFont.png" },
        { path: "Data/Config.INI", sizeBytes: 43, url: "/runtime/rtp/Data/Config.INI" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
    Object.defineProperty(response, "url", { configurable: true, value: indexUrl });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const createPlayer = vi.fn().mockResolvedValue({
      FS: {},
      api: {
        createRuntimeCheckpoint: vi.fn(),
        runtimeState: () => JSON.stringify({
          engine: "RPG2000", ready: true, canCheckpoint: true,
          frameCount: 1, mapId: 1, playerX: 8, playerY: 6, fixtureState: 0,
        }),
      },
      canvas, runtimeFileSystemReady: true, initApi: vi.fn(), pauseMainLoop: vi.fn(), resumeMainLoop: vi.fn(),
    });
    Object.defineProperty(window, "createEasyRpgPlayer", { configurable: true, value: createPlayer });
    const config = easyConfig();
    config.adapter.rtpSource = { kind: "FILE_TREE", indexUrl };
    const mounting = mountEasyRpg(config, target, window, null);
    await vi.waitFor(() => expect(document.head.querySelector("script[data-rpg-runtime=easyrpg]")).not.toBeNull());
    document.head.querySelector<HTMLScriptElement>("script[data-rpg-runtime=easyrpg]")
      ?.dispatchEvent(new Event("load"));

    const mounted = await mounting;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(indexUrl, {
      cache: "default", credentials: "same-origin", redirect: "error",
    });
    expect(createPlayer).toHaveBeenCalledWith(expect.objectContaining({
      runtimeRtpRemoteFiles: [
        { lookupPath: "charset/hero", path: "CharSet/Hero.PNG", url: new URL("/runtime/rtp/CharSet/Hero.PNG", indexUrl).href },
        { lookupPath: "exfont", path: "ExFont.png", url: new URL("/runtime/rtp/ExFont.png", indexUrl).href },
        { lookupPath: "data/config.ini", path: "Data/Config.INI", url: new URL("/runtime/rtp/Data/Config.INI", indexUrl).href },
      ],
    }));
    await mounted.exit();
  });

  it("forces the runtime WebGL context to retain the displayed frame for screenshots", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const createPlayer = vi.fn().mockImplementation(async () => {
      const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
      expect(canvas).not.toBeNull();
      canvas?.getContext("webgl", { alpha: false, preserveDrawingBuffer: false });
      return {
        FS: {},
        api: {
          createRuntimeCheckpoint: vi.fn(),
          runtimeState: () => JSON.stringify({
            engine: "RPG2000", ready: true, canCheckpoint: true,
            frameCount: 1, mapId: 1, playerX: 10, playerY: 8, fixtureState: 0,
          }),
        },
        canvas, runtimeFileSystemReady: true,
        initApi: vi.fn(), pauseMainLoop: vi.fn(), resumeMainLoop: vi.fn(),
      };
    });
    Object.defineProperty(window, "createEasyRpgPlayer", { configurable: true, value: createPlayer });
    const mounting = mountEasyRpg(easyConfig(), target, window, null);
    await vi.waitFor(() => expect(document.head.querySelector("script[data-rpg-runtime=easyrpg]")).not.toBeNull());
    document.head.querySelector<HTMLScriptElement>("script[data-rpg-runtime=easyrpg]")
      ?.dispatchEvent(new Event("load"));

    const mounted = await mounting;
    expect(getContext).toHaveBeenCalledWith("webgl", {
      alpha: false,
      preserveDrawingBuffer: true,
    });
    await mounted.exit();
    getContext.mockRestore();
    delete (window as Window & { createEasyRpgPlayer?: unknown }).createEasyRpgPlayer;
    target.remove();
  });

  it("waits for a non-black encoded frame before returning a screenshot", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const black = new Blob(["black"], { type: "image/png" });
    const screenshot = new Blob(["visible"], { type: "image/png" });
    let sampled = black;
    Object.defineProperty(window, "createImageBitmap", {
      configurable: true,
      value: vi.fn(async (blob: Blob) => {
        sampled = blob;
        return { width: 4, height: 4, close: vi.fn() } as unknown as ImageBitmap;
      }),
    });
    const context2d = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        const data = new Uint8ClampedArray(4 * 4 * 4);
        if (sampled === screenshot) {
          for (let offset = 0; offset < data.length; offset += 4) {
            data.set([45, 180, 138, 255], offset);
          }
        }
        return { data } as ImageData;
      }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((contextId) =>
      contextId === "2d" ? context2d as unknown as CanvasRenderingContext2D : null,
    );
    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(toBlob.mock.calls.length === 1 ? black : screenshot);
    });
    Object.defineProperty(window, "createEasyRpgPlayer", {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
        expect(canvas).not.toBeNull();
        if (!canvas) {throw new Error("test canvas missing");}
        canvas.width = 4;
        canvas.height = 4;
        Object.defineProperty(canvas, "toBlob", { configurable: true, value: toBlob });
        return {
          FS: {},
          api: {
            createRuntimeCheckpoint: vi.fn(),
            runtimeState: () => JSON.stringify({
              engine: "RPG2000", ready: true, canCheckpoint: true,
              frameCount: 1, mapId: 1, playerX: 10, playerY: 8, fixtureState: 0,
            }),
          },
          canvas, runtimeFileSystemReady: true,
          initApi: vi.fn(), pauseMainLoop: vi.fn(), resumeMainLoop: vi.fn(),
        };
      }),
    });
    const mounting = mountEasyRpg(easyConfig(), target, window, null);
    await vi.waitFor(() => expect(document.head.querySelector("script[data-rpg-runtime=easyrpg]")).not.toBeNull());
    document.head.querySelector<HTMLScriptElement>("script[data-rpg-runtime=easyrpg]")
      ?.dispatchEvent(new Event("load"));

    const mounted = await mounting;
    await expect(mounted.screenshot()).resolves.toBe(screenshot);
    expect(toBlob).toHaveBeenCalledTimes(2);
    await mounted.exit();
  });

  it("waits through an incomplete startup state and validates the ready engine", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const canvas = document.createElement("canvas");
    const runtimeState = vi.fn()
      .mockReturnValueOnce("{}")
      .mockReturnValue(JSON.stringify({
        engine: "RPG2003", ready: true, canCheckpoint: true,
        frameCount: 1, mapId: 1, playerX: 10, playerY: 8, fixtureState: 0,
      }));
    Object.defineProperty(window, "createEasyRpgPlayer", {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        FS: {}, api: { runtimeState, createRuntimeCheckpoint: vi.fn() }, canvas,
        runtimeFileSystemReady: true, initApi: vi.fn(), pauseMainLoop: vi.fn(), resumeMainLoop: vi.fn(),
      }),
    });
    const mounting = mountEasyRpg(easyConfig("RPG2003"), target, window, null);
    await vi.waitFor(() => expect(document.head.querySelector("script[data-rpg-runtime=easyrpg]")).not.toBeNull());
    document.head.querySelector<HTMLScriptElement>("script[data-rpg-runtime=easyrpg]")
      ?.dispatchEvent(new Event("load"));

    const mounted = await mounting;
    expect(runtimeState).toHaveBeenCalledTimes(2);
    expect(mounted.getValidationProbe(rpgMakerPositionProbeKind)?.value)
      .toEqual({ mapId: 1, playerX: 10, playerY: 8, fixtureState: 0 });
    await mounted.exit();
    delete (window as Window & { createEasyRpgPlayer?: unknown }).createEasyRpgPlayer;
    target.remove();
  });
});

function easyConfig(generation: "RPG2000" | "RPG2003" = "RPG2000"): EasyConfig {
  const sessionId = "01980000-0000-7000-8000-000000000001";
  const root = `https://games.example/projects/${sessionId}/`;
  const rpg2003 = generation === "RPG2003";
  return {
    sessionId,
    generation,
    validationPurpose: true,
    expectedRestorePosition: null,
    adapter: {
      adapterKind: "EASYRPG_WEB", adapterId: "easyrpg-web", engineMode: rpg2003 ? "rpg2k3" : "rpg2k",
      runtimeBaseUrl: "/runtime/easyrpg/", projectRootUrl: root,
      projectIndexUrl: `${root}index.json`, rtpSource: null, checkpointSlot: 100,
    },
  };
}
