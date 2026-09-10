import {afterEach, describe, expect, it, vi} from "vitest";

import {installEmulatorJs423StateRestoreCompatibility} from "./state-restore.js";
import {installExternalFileCompatibility} from "./external-files.js";
import {installEmulatorJsRetroArchConfig} from "./retroarch-config.js";

const originalFetch = window.fetch;
afterEach(() => {
  vi.useRealTimers();
  window.fetch = originalFetch;
  Reflect.deleteProperty(window, "EJS_GameManager");
  Reflect.deleteProperty(window, "EJS_Runtime");
});

describe("EmulatorJS 4.2.3 explicit restore", () => {
  it("does not autoload a MAME 2003 Plus state before its first emulated frame", async () => {
    vi.useFakeTimers();
    const cleanup = installEmulatorJs423StateRestoreCompatibility(window, true);
    let frame = 0;
    let native: {print?: (message: string) => void; postMainLoop?: () => void} = {};
    const loadedAt: number[] = [];
    class Manager {
      functions = {
        saveStateInfo: () => "1|0|1",
        loadState: () => {
          loadedAt.push(frame);
          window.setTimeout(() => {
            native.print?.('[State] Loading state "game.state".');
            native.postMainLoop?.();
          }, 0);
        },
      };
      FS = {unlink: () => undefined, writeFile: () => undefined};
      getFrameNum() {return frame;}
      toggleMainLoop(running: boolean) {
        if (running && frame === 0) {window.setTimeout(() => {frame = 1;}, 10);}
      }
    }
    Reflect.set(window, "EJS_GameManager", Manager);
    Reflect.set(window, "EJS_Runtime", (config: typeof native) => {native = config;});
    Reflect.get(window, "EJS_Runtime")({});
    const manager = new Manager() as Manager & {loadExplicitStateAndWait: (state: Uint8Array) => Promise<void>};
    const restored = manager.loadExplicitStateAndWait(Uint8Array.of(1));
    await vi.runAllTimersAsync();
    await restored;
    expect(loadedAt).toEqual([1]);
    cleanup();
  });

  it("preserves configuration hooks installed before the deferred GameManager appears", () => {
    const cleanupConfig = installEmulatorJsRetroArchConfig(window, "fuse", true);
    const cleanupExternal = installExternalFileCompatibility(window);
    const cleanupState = installEmulatorJs423StateRestoreCompatibility(window);
    const callMain = vi.fn<(args: string[]) => void>();
    class Manager {Module = {callMain}; writeFile() {} getRetroArchCfg() {return "video_vsync = true\n";}}
    Reflect.set(window, "EJS_GameManager", Manager);
    expect(new Manager().getRetroArchCfg()).toContain('input_libretro_device_p1 = "513"');
    expect(new Manager().getRetroArchCfg()).toContain("log_verbosity = true");
    const manager = new Manager(); manager.getRetroArchCfg(); manager.Module.callMain(["/game.chd"]);
    expect(callMain).toHaveBeenCalledWith(["-v", "/game.chd"]);
    cleanupState();
    cleanupExternal();
    cleanupConfig();
    expect(new Manager().getRetroArchCfg()).toBe("video_vsync = true\n");
  });

  it.each([0, 1])("waits for serialization and the actual native load callback with frame counter %s", async (frame) => {
    vi.useFakeTimers();
    window.fetch = vi.fn(async () => new Response("ok"));
    const cleanup = installEmulatorJs423StateRestoreCompatibility(window);
    let runtimeConfig: {print?: (...args: unknown[]) => void; postMainLoop?: (...args: unknown[]) => void} = {};
    const files = new Map<string, Uint8Array>();
    let probes = 0;
    const loop = vi.fn();
    const originalPostMainLoop = vi.fn();
    class Manager {
      functions = {
        saveStateInfo: () => ++probes < 2 ? "Error|0|0" : "1|0|1",
        loadState: () => window.setTimeout(() => {
          runtimeConfig.postMainLoop?.();
          runtimeConfig.postMainLoop?.();
          window.setTimeout(() => {
            runtimeConfig.print?.('[INFO] [State]: Loading state "game.state", 3 bytes.');
            runtimeConfig.postMainLoop?.();
          }, 500);
        }, 0),
      };
      FS = {
        unlink: (path: string) => {if (!files.delete(path)) {throw new Error("ENOENT");}},
        writeFile: (path: string, bytes: Uint8Array) => files.set(path, new Uint8Array(bytes)),
      };
      getFrameNum() {return frame;}
      getState() {return new Uint8Array(files.get("/game.state") ?? []);}
      toggleMainLoop(running: boolean) {loop(running);}
    }
    Reflect.set(window, "EJS_GameManager", Manager);
    Reflect.set(window, "EJS_Runtime", (config: typeof runtimeConfig) => {runtimeConfig = config; return {};});
    (Reflect.get(window, "EJS_Runtime") as (config: typeof runtimeConfig) => unknown)({
      postMainLoop: originalPostMainLoop,
    });
    const manager = new Manager() as Manager & {
      loadExplicitStateAndWait: (state: Uint8Array, timeoutMs?: number) => Promise<void>;
    };

    const restore = manager.loadExplicitStateAndWait(Uint8Array.of(1, 2, 3));
    let completed = false;
    void restore.then(() => {completed = true;});
    const restored = expect(restore).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(completed).toBe(false);
    await vi.runAllTimersAsync();
    await restored;
    expect(probes).toBe(2);
    expect(originalPostMainLoop).toHaveBeenCalledTimes(3);
    expect(loop.mock.calls.at(-1)).toEqual([false]);
    expect(files.size).toBe(0);
    const version = await window.fetch("https://cdn.emulatorjs.org/stable/data/version.json");
    expect(await version.json()).toEqual({current_version: "4.2.3", version: "4.2.3"});
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a native failed-state signal before loop completion", async () => {
    vi.useFakeTimers();
    const cleanup = installEmulatorJs423StateRestoreCompatibility(window);
    let runtimeConfig: {print?: (...args: unknown[]) => void; printErr?: (...args: unknown[]) => void} = {};
    class Manager {
      functions = {
        saveStateInfo: () => "1|0|1",
        loadState: () => window.setTimeout(() =>
          runtimeConfig.printErr?.('[ERROR] [State]: Failed to load state from "game.state".'), 0),
      };
      FS = {unlink: () => undefined, writeFile: () => undefined};
      getFrameNum() {return 1;}
      getState() {return Uint8Array.of(9);}
      toggleMainLoop() {return undefined;}
    }
    Reflect.set(window, "EJS_GameManager", Manager);
    Reflect.set(window, "EJS_Runtime", (config: typeof runtimeConfig) => {runtimeConfig = config; return {};});
    (Reflect.get(window, "EJS_Runtime") as (config: typeof runtimeConfig) => unknown)({});
    const manager = new Manager() as Manager & {
      loadExplicitStateAndWait: (state: Uint8Array, timeoutMs?: number) => Promise<void>;
    };
    const restore = manager.loadExplicitStateAndWait(Uint8Array.of(1));
    const failure = expect(restore).rejects.toThrow("PLAYER_SAVE_STATE_RESTORE_FAILED");
    await vi.runAllTimersAsync();
    await failure;
    cleanup();
  });

  it("times out when the native main loop does not process the queued load", async () => {
    vi.useFakeTimers();
    const cleanup = installEmulatorJs423StateRestoreCompatibility(window);
    class Manager {
      functions = {
        saveStateInfo: () => "1|0|1",
        loadState: () => undefined,
      };
      FS = {unlink: () => undefined, writeFile: () => undefined};
      getState() {return Uint8Array.of(9);}
      toggleMainLoop() {return undefined;}
    }
    Reflect.set(window, "EJS_GameManager", Manager);
    const manager = new Manager() as Manager & {
      loadExplicitStateAndWait: (state: Uint8Array, timeoutMs?: number) => Promise<void>;
    };
    const restore = manager.loadExplicitStateAndWait(Uint8Array.of(1), 10);
    const failure = expect(restore).rejects.toThrow("PLAYER_SAVE_STATE_RESTORE_TIMEOUT");
    await vi.runAllTimersAsync();
    await failure;
    cleanup();
  });
});
