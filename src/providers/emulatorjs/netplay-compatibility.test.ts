import {afterEach, describe, expect, it, vi} from "vitest";

import {installEmulatorJs423NetplayCompatibility} from "./netplay-compatibility.js";

describe("EmulatorJS 4.2.3 netplay compatibility", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "EJS_Runtime");
    Reflect.deleteProperty(window, "EJS_GameManager");
    Reflect.deleteProperty(window, "__RETROM_POST_MAIN_LOOP__");
  });

  it("patches constructors before startup and restores every scoped hook", async () => {
    const originalFetch = window.fetch;
    window.fetch = vi.fn(async () => new Response("ok"));
    const cleanup = installEmulatorJs423NetplayCompatibility(window);
    let runtimeConfig: {postMainLoop?: () => void; print?: (...args: unknown[]) => void} = {};
    class GameManager {
      paths: string[] = [];
      frame = 0;
      running = false;
      functions = {loadState: () => 1};
      FS = {unlink: () => undefined, writeFile: () => undefined};
      mountFileSystems() {throw new Error("persistent storage must not mount");}
      mkdir(path: string) {this.paths.push(path);}
      getFrameNum() {return this.frame;}
      getState() {return Uint8Array.from([1]);}
      toggleMainLoop(running: boolean) {
        this.running = running;
        if (running) {
          window.setTimeout(() => {
            if (!this.running) {return;}
            this.frame += 1;
            runtimeConfig.postMainLoop?.();
          }, 0);
        }
      }
    }
    Reflect.set(window, "EJS_GameManager", GameManager);
    Reflect.set(window, "EJS_Runtime", (config: typeof runtimeConfig) => {runtimeConfig = config; return {};});
    const runtimeFactory = Reflect.get(window, "EJS_Runtime") as (config: typeof runtimeConfig) => unknown;
    runtimeFactory({});
    const manager = new GameManager() as GameManager & {
      mountFileSystems(): Promise<void>;
      runNetplayFrame(): Promise<number>;
    };
    await manager.mountFileSystems();
    expect(manager.paths).toEqual(["/data", "/data/saves"]);
    await expect(manager.runNetplayFrame()).resolves.toBe(1);
    const version = await window.fetch("https://cdn.emulatorjs.org/stable/data/version.json");
    await expect(version.json()).resolves.toEqual({version: "4.2.3", current_version: "4.2.3"});
    cleanup();
    expect(Object.getOwnPropertyDescriptor(window, "EJS_GameManager")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(window, "EJS_Runtime")).toBeUndefined();
    window.fetch = originalFetch;
  });

  it("uses a fake-clock active timeout and cancels all pending work", async () => {
    vi.useFakeTimers();
    const originalFetch = window.fetch;
    window.fetch = vi.fn(async () => new Response("ok"));
    const cleanup = installEmulatorJs423NetplayCompatibility(window);
    const mainLoop = vi.fn();
    class GameManager {
      frame = 0;
      functions = {loadState: () => 1};
      FS = {unlink: () => undefined, writeFile: () => undefined};
      async mountFileSystems() {return undefined;}
      getFrameNum() {return this.frame;}
      getState() {return Uint8Array.from([1]);}
      toggleMainLoop(running: boolean) {mainLoop(running);}
    }
    Reflect.set(window, "EJS_GameManager", GameManager);
    const manager = new GameManager() as GameManager & {
      cancelNetplayOperations(): void;
      runNetplayFrame(): Promise<number>;
    };
    const frame = manager.runNetplayFrame();
    const failure = expect(frame).rejects.toThrow("NETPLAY_FRAME_STEP_TIMEOUT");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(mainLoop.mock.calls.at(-1)).toEqual([true]);
    await vi.advanceTimersByTimeAsync(1);
    await failure;
    expect(mainLoop.mock.calls.at(-1)).toEqual([false]);

    const cancelled = manager.runNetplayFrame();
    const cancelledFailure = expect(cancelled).rejects.toThrow("NETPLAY_SESSION_ENDED");
    manager.cancelNetplayOperations();
    await cancelledFailure;
    expect(vi.getTimerCount()).toBe(0);
    cleanup();
    window.fetch = originalFetch;
  });
});
