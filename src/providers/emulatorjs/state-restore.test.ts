import {afterEach, describe, expect, it, vi} from "vitest";

import {installEmulatorJs423StateRestoreCompatibility} from "./state-restore.js";

const originalFetch = window.fetch;
afterEach(() => {
  vi.useRealTimers();
  window.fetch = originalFetch;
  Reflect.deleteProperty(window, "EJS_GameManager");
  Reflect.deleteProperty(window, "EJS_Runtime");
});

describe("EmulatorJS 4.2.3 explicit restore", () => {
  it("waits for serializable state and native load completion", async () => {
    vi.useFakeTimers();
    window.fetch = vi.fn(async () => new Response("ok"));
    const cleanup = installEmulatorJs423StateRestoreCompatibility(window);
    let runtimeConfig: {print?: (...args: unknown[]) => void} = {};
    const files = new Map<string, Uint8Array>();
    let frame = 0;
    let probes = 0;
    const loop = vi.fn((running: boolean) => {if (running) {frame = 1;}});
    class Manager {
      functions = {
        saveStateInfo: () => ++probes < 2 ? "Error|0|0" : "1|0|1",
        loadState: () => window.setTimeout(() =>
          runtimeConfig.print?.('[INFO] [State]: Loading state "game.state", 3 bytes.'), 0),
      };
      FS = {
        unlink: (path: string) => {if (!files.delete(path)) {throw new Error("ENOENT");}},
        writeFile: (path: string, bytes: Uint8Array) => files.set(path, new Uint8Array(bytes)),
      };
      getFrameNum() {return frame;}
      toggleMainLoop(running: boolean) {loop(running);}
    }
    Reflect.set(window, "EJS_GameManager", Manager);
    Reflect.set(window, "EJS_Runtime", (config: typeof runtimeConfig) => {runtimeConfig = config; return {};});
    (Reflect.get(window, "EJS_Runtime") as (config: typeof runtimeConfig) => unknown)({});
    const manager = new Manager() as Manager & {
      loadExplicitStateAndWait: (state: Uint8Array) => Promise<void>;
    };

    const restore = manager.loadExplicitStateAndWait(Uint8Array.of(1, 2, 3));
    await vi.runAllTimersAsync();
    await expect(restore).resolves.toBeUndefined();
    expect(probes).toBe(2);
    expect(loop.mock.calls.at(-1)).toEqual([false]);
    expect(files.size).toBe(0);
    const version = await window.fetch("https://cdn.emulatorjs.org/stable/data/version.json");
    expect(await version.json()).toEqual({current_version: "4.2.3", version: "4.2.3"});
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a native failed-state signal", async () => {
    vi.useFakeTimers();
    const cleanup = installEmulatorJs423StateRestoreCompatibility(window);
    let runtimeConfig: {printErr?: (...args: unknown[]) => void} = {};
    class Manager {
      functions = {
        saveStateInfo: () => "1|0|1",
        loadState: () => window.setTimeout(() =>
          runtimeConfig.printErr?.('[ERROR] [State]: Failed to load state from "game.state".'), 0),
      };
      FS = {unlink: () => undefined, writeFile: () => undefined};
      getFrameNum() {return 1;}
      toggleMainLoop() {return undefined;}
    }
    Reflect.set(window, "EJS_GameManager", Manager);
    Reflect.set(window, "EJS_Runtime", (config: typeof runtimeConfig) => {runtimeConfig = config; return {};});
    (Reflect.get(window, "EJS_Runtime") as (config: typeof runtimeConfig) => unknown)({});
    const manager = new Manager() as Manager & {
      loadExplicitStateAndWait: (state: Uint8Array) => Promise<void>;
    };
    const restore = manager.loadExplicitStateAndWait(Uint8Array.of(1));
    const failure = expect(restore).rejects.toThrow("PLAYER_SAVE_STATE_RESTORE_FAILED");
    await vi.runAllTimersAsync();
    await failure;
    cleanup();
  });
});
