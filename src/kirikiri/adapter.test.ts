import { afterEach, describe, expect, it, vi } from "vitest";

import {
  config, enableRuntimeFeatures, fakeVlfs, loadCore, loadVlfs, mockDownloads, runtimeScripts, type HostWindow,
} from "../../tests/kirikiri-adapter-fixture.js";
import {currentWindowHost} from "../../tests/provider-adapter-fixture.js";
import { createRuntime } from "../index.js";
import {KirikiriContent} from "./content.js";

vi.mock("./content.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./content.js")>();
  return {...actual, KirikiriContent: class extends actual.KirikiriContent {
    override async assets(base: URL) {
      return {vlfsUrl: new URL("vlfs.js", base).href, scriptUrl: new URL("index.js", base).href,
        wasmUrl: "blob:kirikiri-verified-wasm", archive: new Blob([Uint8Array.of(1)])};
    }
  }};
});


afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, "getGamepads");
  delete (window as HostWindow).Module;
  delete (window as HostWindow).VLFS;
  document.body.replaceChildren();
  document.head.querySelectorAll("script[data-runtime=kirikiri2]").forEach((script) => script.remove());
});

describe("KiriKiri2 KAG runtime", () => {
  it("queues real browser haptic calls as best effort and stops them on exit", async () => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs(); mockDownloads();
    const actuator = {playEffect: vi.fn().mockRejectedValue(new Error("hardware unavailable")),
      reset: vi.fn().mockResolvedValue("complete")};
    const pad = {id: "haptic controller", index: 3, connected: true, mapping: "standard",
      axes: [0, 0], buttons: Array.from({length: 17}, () => gamepadButton()), vibrationActuator: actuator};
    Object.defineProperty(window.navigator, "getGamepads", {configurable: true, value: () => [pad]});
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    const module = await loadCore(vlfs); await mounting;
    const bridge = module as unknown as {retromGamepadVibrate: (index: number, id: string, left: number, right: number) => void};
    try {
      bridge.retromGamepadVibrate(3, pad.id, 1, 0.5);
      expect(actuator.playEffect).toHaveBeenCalledWith("dual-rumble", {duration: 250, startDelay: 0, strongMagnitude: 1, weakMagnitude: 0.5});
      bridge.retromGamepadVibrate(3, "disconnected controller", 1, 1);
      expect(actuator.playEffect).toHaveBeenCalledOnce();
      bridge.retromGamepadVibrate(3, pad.id, 0, 0);
      expect(actuator.reset).toHaveBeenCalledOnce();
      await runtime.pause();
      bridge.retromGamepadVibrate(3, pad.id, 1, 1);
      expect(actuator.playEffect).toHaveBeenCalledOnce();
      await runtime.resume();
      bridge.retromGamepadVibrate(3, pad.id, 1, 1);
      expect(actuator.playEffect).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new Event("blur"));
      bridge.retromGamepadVibrate(3, pad.id, 1, 1);
      expect(actuator.playEffect).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new Event("focus"));
      bridge.retromGamepadVibrate(3, pad.id, 1, 1);
      expect(actuator.playEffect).toHaveBeenCalledTimes(3);
      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      document.dispatchEvent(new Event("visibilitychange"));
      bridge.retromGamepadVibrate(3, pad.id, 1, 1);
      expect(actuator.playEffect).toHaveBeenCalledTimes(3);
      hidden.mockReturnValue(false);
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {await runtime.exit();}
    expect(actuator.reset).toHaveBeenCalledTimes(4);
    bridge.retromGamepadVibrate(3, pad.id, 1, 1);
    expect(actuator.playEffect).toHaveBeenCalledTimes(3);
  });
  it("enumerates controller metadata without consuming the filtered state and releases the native ownership bridge on exit", async () => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs(); mockDownloads();
    const pad = {id: "standard controller", index: 3, mapping: "standard", connected: true,
      axes: [0, 0], buttons: Array.from({length: 17}, () => gamepadButton())};
    Object.defineProperty(window.navigator, "getGamepads", {configurable: true, value: () => [null, pad]});
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    await vi.waitFor(() => expect(runtimeScripts()).toHaveLength(2));
    const bridge = (window as HostWindow).Module as {retromGamepadDevices: () => unknown[];
      retromGamepadSamples: () => (Gamepad | null)[]; onGamepadInputChanged: (active: boolean) => void};
    if (typeof bridge.onGamepadInputChanged === "function") {bridge.onGamepadInputChanged(true);}
    await loadCore(vlfs); await mounting;
    try {
      expect(bridge.retromGamepadDevices()).toEqual([{id: pad.id, index: 3, mapping: "standard", connected: true}]);
      expect(bridge.retromGamepadSamples()[1]).toMatchObject({id: pad.id, index: 3, connected: true});
    }
    finally {await runtime.exit();}
    expect(bridge.retromGamepadDevices()).toEqual([]);
    expect(bridge.retromGamepadSamples()).toEqual([]);
    expect(() => bridge.onGamepadInputChanged(false)).not.toThrow();
  });
  it("supplies explicit engine arguments and an opted-in local service before native startup", async () => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs(); mockDownloads();
    const envelope = config();
    envelope.targetOptions.engineArguments = ["-locale=first", "-flag", "-locale=second", "-caption=中文 text", "-empty="];
    envelope.targetOptions.steamService = "LOCAL";
    const runtime = await createRuntime(envelope, currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    const module = await loadCore(vlfs); await mounting;
    try {
      expect(module.arguments).toEqual(envelope.targetOptions.engineArguments);
      expect(module.retromLocalSteamService).toBe(true);
      expect(module._krkr2_host_engine_arguments_abi).toHaveBeenCalledOnce();
      expect(module._krkr2_host_local_steam_service_abi).toHaveBeenCalledOnce();
    } finally {await runtime.exit();}
  });
  it.each([
    ["engineArguments", ["-locale=value"], {engineArgumentsSupported: false}, "KIRIKIRI_ENGINE_ARGUMENTS_UNSUPPORTED"],
    ["steamService", "LOCAL", {localSteamSupported: false}, "KIRIKIRI_LOCAL_STEAM_SERVICE_UNSUPPORTED"],
  ] as const)("rejects unsupported explicit %s before native scripts", async (key, value, options, code) => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs(); mockDownloads();
    const envelope = config(); envelope.targetOptions[key] = typeof value === "string" ? value : [...value];
    const runtime = await createRuntime(envelope, currentWindowHost(null));
    const outcome = runtime.mount(document.createElement("div")).catch(error => error as Error);
    await loadVlfs(vlfs);
    await expect(loadCore(vlfs, options)).rejects.toThrow(code);
    expect(await outcome).toMatchObject({message: code});
    expect((window as HostWindow).Module).toBeUndefined();
  });
  it("keeps optional native arguments and local services disabled when not configured", async () => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs(); mockDownloads();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    const module = await loadCore(vlfs, {engineArgumentsSupported: false, localSteamSupported: false}); await mounting;
    try {expect(module.arguments).toEqual([]); expect(module.retromLocalSteamService).toBe(false);}
    finally {await runtime.exit();}
  });
  it("passes an explicit resource search layer while preserving the complete original file tree", async () => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs();
    mockDownloads(["/data.xp3", "/images/title.png", "/translations/custom/images/title.png", "/translations/custom/chapter.ks"]);
    const envelope = config(); envelope.targetOptions.overlayRoot = "translations/custom";
    const runtime = await createRuntime(envelope, currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    const module = await loadCore(vlfs); await mounting;
    try {
      const calls = vlfs.registerContent.mock.calls as unknown as Array<[string, unknown, unknown]>;
      expect(calls.filter(([path]) => path === "/images/title.png")).toHaveLength(1);
      expect(calls.some(([path]) => path === "/chapter.ks")).toBe(false);
      expect(module._resourceOverlayFiles).toEqual([
        {path: "/translations/custom/images/title.png", relativePath: "images/title.png"},
        {path: "/translations/custom/chapter.ks", relativePath: "chapter.ks"},
      ]);
      expect(module._krkr2_host_resource_overlay_abi).toHaveBeenCalledOnce();
    } finally {await runtime.exit();}
  });
  it.each(["absent", "Translations/custom"])("rejects a missing exact overlay root %s before starting scripts", async overlayRoot => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs(); mockDownloads(["/data.xp3", "/translations/custom/chapter.ks"]);
    const envelope = config(); envelope.targetOptions.overlayRoot = overlayRoot;
    const runtime = await createRuntime(envelope, currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    const outcome = mounting.catch(error => error as Error); await loadVlfs(vlfs);
    expect(await outcome).toMatchObject({message: "KIRIKIRI_PROJECT_OVERLAY_INVALID"});
    expect(runtimeScripts()).toHaveLength(0);
    expect((window as HostWindow).Module).toBeUndefined();
  });
  it("rejects an explicit resource search layer on a core without its ABI", async () => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs(); mockDownloads(["/data.xp3", "/patches/chapter.ks"]);
    const envelope = config(); envelope.targetOptions.overlayRoot = "patches";
    const runtime = await createRuntime(envelope, currentWindowHost(null));
    const outcome = runtime.mount(document.createElement("div")).catch(error => error as Error);
    await loadVlfs(vlfs);
    await expect(loadCore(vlfs, {overlaySupported: false})).rejects.toThrow("KIRIKIRI_RESOURCE_OVERLAY_UNSUPPORTED");
    expect(await outcome).toMatchObject({message: "KIRIKIRI_RESOURCE_OVERLAY_UNSUPPORTED"});
  });
  it.each([["KIRIKIRI2", 0], ["KIRIKIRI_Z", 1]] as const)("selects %s before the core starts game scripts", async (mode, nativeMode) => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs(); mockDownloads();
    const envelope = config(); envelope.targetOptions.engineMode = mode;
    const runtime = await createRuntime(envelope, currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    const module = await loadCore(vlfs); await mounting;
    try {expect(module._krkr2_host_set_engine_mode).toHaveBeenCalledExactlyOnceWith(nativeMode);}
    finally {await runtime.exit();}
  });
  it.each([{engineModeSupported: false}, {engineModeResult: -1}])("rejects an unsupported explicit Z mode without starting in another mode", async options => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs(); mockDownloads();
    const envelope = config(); envelope.targetOptions.engineMode = "KIRIKIRI_Z";
    const runtime = await createRuntime(envelope, currentWindowHost(null));
    const outcome = runtime.mount(document.createElement("div")).catch(error => error as Error);
    await loadVlfs(vlfs);
    await expect(loadCore(vlfs, options)).rejects.toThrow("KIRIKIRI_ENGINE_MODE_UNSUPPORTED");
    expect(await outcome).toMatchObject({message: "KIRIKIRI_ENGINE_MODE_UNSUPPORTED"});
    expect((window as HostWindow).Module).toBeUndefined();
    expect(runtimeScripts()).toHaveLength(0);
  });
  it("retains the original default when a core has no optional mode setter", async () => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs(); mockDownloads();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    await loadCore(vlfs, {engineModeSupported: false}); await mounting;
    await runtime.exit();
  });
  it.each(["exit", "mount-abort"] as const)("drains a suspended tick before releasing globals on %s", async (mode) => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const close = vi.spyOn(KirikiriContent.prototype, "close");
    let finishTick!: () => void;
    const tick = new Promise<void>(resolve => {finishTick = resolve;});
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    const mounted = mounting.catch(error => error as Error);
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs, {abort: mode === "mount-abort", stopping: tick});
    let stopping: Promise<unknown>;
    if (mode === "exit") {await mounting; stopping = runtime.exit();}
    else {stopping = mounted;}
    let stopped = false;
    void stopping.then(() => {stopped = true;});
    try {
      await vi.waitFor(() => expect(module.krkr2StopMainLoop).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
      expect(close).toHaveBeenCalledAfter(module.krkr2StopMainLoop);
      expect(stopped).toBe(false);
      expect((window as HostWindow).Module).toBe(module);
      expect((window as HostWindow).VLFS).toBe(vlfs);
    } finally {finishTick(); await stopping;}
    expect((window as HostWindow).Module).toBeUndefined();
    expect((window as HostWindow).VLFS).toBeUndefined();
    if (mode === "mount-abort") {expect(await mounted).toMatchObject({message: "KIRIKIRI_RUNTIME_ABORTED"});}
  });

  it("releases a failed core whose native stack never unwinds", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs, {stopping: new Promise<void>(() => undefined)});
    await mounting;
    vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
    try {
      module.onAbort?.("engine stopped");
      await vi.waitFor(() => expect(module.krkr2StopMainLoop).toHaveBeenCalledOnce());
      expect((window as HostWindow).Module).toBe(module);
      await vi.advanceTimersByTimeAsync(5_000);
    } finally {vi.useRealTimers();}
    await vi.waitFor(() => expect((window as HostWindow).Module).toBeUndefined());
    expect((window as HostWindow).VLFS).toBeUndefined();
    expect(runtime.getState()).toBe("FAILED");
  });

  it("cleans up a core script failure before the main loop is initialized", async () => {
    enableRuntimeFeatures();
    mockDownloads();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    const outcome = mounting.catch(error => error as Error);
    await loadVlfs(fakeVlfs());
    await vi.waitFor(() => expect(runtimeScripts()).toHaveLength(2));
    runtimeScripts()[1]!.dispatchEvent(new Event("error"));
    expect(await outcome).toMatchObject({message: "KIRIKIRI_RUNTIME_ARTIFACT_UNAVAILABLE"});
    expect(runtimeScripts()).toHaveLength(0);
    expect((window as HostWindow).Module).toBeUndefined();
    expect((window as HostWindow).VLFS).toBeUndefined();
  });

  it("loads the verified Wasm Blob through the SDK loader without a network fallback", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const network = fetch;
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs);
    await mounting;
    try {
      expect(module.locateFile("index.wasm")).toBe("blob:kirikiri-verified-wasm");
      expect(module.wasmBinary).toBeUndefined();
      expect(network).toHaveBeenCalledTimes(1);
    } finally {await runtime.exit();}
  });
  const runtimeTerminationCases: ReadonlyArray<readonly [string, "error" | "unhandledrejection"]> = [
    "null function",
    "function signature mismatch",
    "null function or function signature mismatch",
    "table index is out of bounds",
    "memory access out of bounds",
    "unreachable",
  ].flatMap((message) => (["error", "unhandledrejection"] as const)
    .map((transport) => [message, transport] as const));

  it.each(runtimeTerminationCases)(
    "reports the KiriKiri wasm %s trap from %s as one fatal error",
    async (terminationMessage, transport) => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const events: string[] = [];
    runtime.subscribe((event) => events.push(event.type));
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs);
    await mounting;
    const unrelated = new WebAssembly.RuntimeError("null function");
    Object.defineProperty(unrelated, "stack", { value: "RuntimeError: null function\n at blob:another-wasm:wasm-function[1852]:0x90236" });

    expect(window.dispatchEvent(runtimeFailureEvent(transport, unrelated))).toBe(true);
    expect(runtime.getState()).toBe("RUNNING");

    const termination = new WebAssembly.RuntimeError(terminationMessage);
    Object.defineProperty(termination, "stack", {
      value: `RuntimeError: ${terminationMessage}\n` +
        " at blob:kirikiri-verified-wasm:wasm-function[1852]:0x90236",
    });
    expect(window.dispatchEvent(runtimeFailureEvent(transport, termination))).toBe(false);

    await vi.waitFor(() => expect(runtime.getState()).toBe("FAILED"));
    await vi.waitFor(() => expect(module.krkr2StopMainLoop).toHaveBeenCalledOnce());
    expect(module.krkr2StopMainLoop).toHaveBeenCalledWith(undefined, true);
    expect(events.filter(type => type === "FATAL_ERROR")).toHaveLength(1);
    expect(events.filter(type => type === "EXIT_REQUESTED")).toHaveLength(0);
    },
  );

  it("finishes ordinary startup without waiting for a bookmark or creating a native save", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs, { bookmarkReady: 0 });

    const outcome = await Promise.race([
      mounting.then(() => "mounted"),
      new Promise<string>((resolve) => setTimeout(() => resolve("still-waiting"), 25)),
    ]);
    expect(runtime.getCheckpointAvailability()).toMatchObject({ available: false, reason: "NO_SAVE" });
    await mounting;

    expect(outcome).toBe("mounted");
    expect(runtime.getCheckpointAvailability()).toMatchObject({ available: false, reason: "NO_SAVE" });
    expect(module._krkr2_host_bookmark_is_ready).not.toHaveBeenCalled();
    expect(module._krkr2_host_save_bookmark).not.toHaveBeenCalled();
    await runtime.exit();
  });

  it("reports the engine process exit and makes checkpointing unavailable", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const events: string[] = [];
    runtime.subscribe((event) => events.push(event.type));
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs);
    await mounting;

    module.onExit?.(0);

    await vi.waitFor(() => expect(runtime.getState()).toBe("EXITED"));
    expect(events.filter((type) => type === "EXIT_REQUESTED")).toHaveLength(1);
    expect(runtime.getCheckpointAvailability()).toEqual({ available: false, reason: "NOT_READY" });
  });

  it.each(["abort", "nonzero-exit"])("reports %s after mount as one fatal failure and cleans up", async mode => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs(); mockDownloads();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const events: Array<{type: string; failure?: {code: string; phase: string}}> = [];
    runtime.subscribe(event => events.push(event));
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs); await mounting;
    for (let repeat = 0; repeat < 2; repeat++) {
      if (mode === "abort") {module.onAbort?.("engine stopped");} else {module.onExit?.(7);}
    }
    module.onExit?.(0);
    await vi.waitFor(() => expect(runtime.getState()).toBe("FAILED"));
    await vi.waitFor(() => expect((window as HostWindow).Module).toBeUndefined());
    expect(events.filter(event => event.type === "FATAL_ERROR")).toEqual([
      expect.objectContaining({failure: expect.objectContaining({phase: "PLAYING", code: mode === "abort" ? "KIRIKIRI_RUNTIME_ABORTED" : "KIRIKIRI_RUNTIME_EXIT_FAILED"})}),
    ]);
    expect(events.filter(event => event.type === "EXIT_REQUESTED")).toHaveLength(0);
    expect(runtime.getCheckpointAvailability()).toEqual({available: false, reason: "FAILED"});
    expect(module.krkr2StopMainLoop).toHaveBeenCalledOnce();
    await expect(runtime.checkpoint()).rejects.toThrow();
  });

  it("reports a structured unhandled script exception once and releases the failed core", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs(); mockDownloads();
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const events: Array<{type: string; failure?: {code: string}}> = [];
    runtime.subscribe(event => events.push(event));
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    const module = await loadCore(vlfs); await mounting;
    const detail = {message: 'Member "Sqlite" does not exist', script: "start.ks", line: 9, trace: "scene.start"};
    module.onScriptException?.(detail);
    module.onScriptException?.(detail);
    await vi.waitFor(() => expect(runtime.getState()).toBe("FAILED"));
    await vi.waitFor(() => expect((window as HostWindow).Module).toBeUndefined());
    expect(events.filter(event => event.type === "FATAL_ERROR")).toEqual([
      expect.objectContaining({failure: expect.objectContaining({code: "KIRIKIRI_SCRIPT_EXCEPTION",
        diagnostics: expect.arrayContaining([
          {source: "CORE", message: detail.message}, {source: "CORE", message: "start.ks:9"},
          {source: "CORE", message: detail.trace},
        ])})}),
    ]);
    expect(runtime.getCheckpointAvailability()).toEqual({available: false, reason: "FAILED"});
  });

  it.each([1, 1.5, 2])("tracks the surface and DPR %s and releases resize listeners on exit", async ratio => {
    enableRuntimeFeatures(); mockDownloads();
    let width = 800, height = 600;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(ratio);
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    const vlfs = fakeVlfs(); await loadVlfs(vlfs); await loadCore(vlfs); await mounting;
    const canvas = document.querySelector<HTMLCanvasElement>("#game canvas")!;
    expect([canvas.width, canvas.height]).toEqual([800 * ratio, 600 * ratio]);
    width = 1000; height = 500;
    window.dispatchEvent(new Event("resize"));
    expect([canvas.width, canvas.height]).toEqual([1000 * ratio, 500 * ratio]);
    expect([canvas.style.width, canvas.style.height]).toEqual(["100%", "100%"]);
    await runtime.exit();
    width = 640; height = 480;
    window.dispatchEvent(new Event("resize"));
    expect([canvas.width, canvas.height]).toEqual([1000 * ratio, 500 * ratio]);
  });

  it("does not carry startup input into the ready runtime", async () => {
    enableRuntimeFeatures();
    const animationFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const buttons = Array.from({ length: 16 }, () => gamepadButton());
    buttons[0] = gamepadButton(true);
    Object.defineProperty(window.navigator, "getGamepads", {
      configurable: true,
      value: vi.fn(() => [{ index: 0, axes: [0, 0], buttons, connected: true, mapping: "standard" }]),
    });
    const vlfs = fakeVlfs();
    mockDownloads();
    const target = document.createElement("div");
    document.body.append(target);
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(target);
    await vi.waitFor(() => expect(document.querySelector("#game canvas")).not.toBeNull());
    const canvas = document.querySelector("#game")!.querySelector("canvas");
    if (!canvas) {throw new Error("test canvas missing");}
    const inputs: string[] = [];
    canvas.addEventListener("mousedown", () => inputs.push("mousedown"));
    canvas.addEventListener("click", () => inputs.push("click"));
    canvas.addEventListener("keydown", () => inputs.push("keydown"));

    animationFrames.splice(0).forEach(callback => callback(0));
    canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true }));

    expect(inputs).toEqual([]);
    await loadVlfs(vlfs);
    await loadCore(vlfs);
    await mounting;
    animationFrames.splice(0).forEach(callback => callback(16));
    buttons[0] = gamepadButton();
    animationFrames.splice(0).forEach(callback => callback(32));
    expect(inputs).toEqual([]);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true }));
    buttons[0] = gamepadButton(true);
    animationFrames.splice(0).forEach(callback => callback(48));
    buttons[0] = gamepadButton();
    animationFrames.splice(0).forEach(callback => callback(64));
    expect(inputs).toEqual(["keydown", "mousedown", "click"]);
    await runtime.exit();
  });

  it("maps standard gamepad directions and face buttons to KiriKiri mouse input", async () => {
    enableRuntimeFeatures();
    const animationFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const axes = [0, 0];
    const buttons = Array.from({ length: 16 }, () => gamepadButton());
    Object.defineProperty(window.navigator, "getGamepads", {
      configurable: true,
      value: vi.fn(() => [{ index: 0, axes, buttons, connected: true, mapping: "standard" }]),
    });
    const vlfs = fakeVlfs();
    mockDownloads();
    const target = document.createElement("div");
    document.body.append(target);
    const runtime = await createRuntime(config(), currentWindowHost(null));
    const mounting = runtime.mount(target);
    await loadVlfs(vlfs);
    await loadCore(vlfs);
    await mounting;
    const canvas = document.querySelector("#game")!.querySelector("canvas");
    if (!canvas) {throw new Error("test canvas missing");}
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(domRect(100, 50, 800, 600));
    const inputs: string[] = [];
    for (const type of ["mousemove", "mousedown", "mouseup", "click", "contextmenu"]) {
      canvas.addEventListener(type, (event) => {
        const mouse = event as MouseEvent;
        inputs.push(`${type}:${mouse.button}:${Math.round(mouse.clientX)}:${Math.round(mouse.clientY)}`);
      });
    }

    animationFrames.splice(0).forEach(callback => callback(0));
    axes[0] = 0.75;
    animationFrames.splice(0).forEach(callback => callback(100));
    axes[0] = 0;
    animationFrames.splice(0).forEach(callback => callback(116));
    buttons[0] = gamepadButton(true);
    animationFrames.splice(0).forEach(callback => callback(132));
    buttons[0] = gamepadButton();
    animationFrames.splice(0).forEach(callback => callback(148));
    buttons[1] = gamepadButton(true);
    animationFrames.splice(0).forEach(callback => callback(164));
    buttons[1] = gamepadButton();
    animationFrames.splice(0).forEach(callback => callback(180));

    expect(inputs.some((value) => value.startsWith("mousemove:0:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("mousedown:0:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("mouseup:0:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("click:0:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("mousedown:2:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("mouseup:2:"))).toBe(true);
    expect(inputs.some((value) => value.startsWith("contextmenu:2:"))).toBe(true);
    const cursor = document.querySelector<HTMLElement>("[data-gamepad-cursor]");
    expect(cursor?.hidden).toBe(false);
    expect(cursor?.style.transform).toContain("translate");
    await runtime.exit();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it.each([["data.bin", "/data.bin"], ["startup.tjs", "/"]])("starts the selected %s despite other archives", async (entry, expected) => {
    enableRuntimeFeatures(); const vlfs = fakeVlfs();
    mockDownloads(["/data.bin", "/patch.xp3"]);
    const envelope = config(); envelope.targetOptions.startupXp3Path = entry;
    const runtime = await createRuntime(envelope, currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div")); await loadVlfs(vlfs);
    const module = await loadCore(vlfs); await mounting;
    expect(module._startupXp3Path).toBe(expected);
    await runtime.exit();
  });

  it("fails closed when the explicit selected entry is absent from the public tree", async () => {
    enableRuntimeFeatures();
    const vlfs = fakeVlfs();
    mockDownloads(["/data.xp3", "/patch.xp3"]);
    const envelope = config(); envelope.targetOptions.startupXp3Path = "missing.bin";
    const runtime = await createRuntime(envelope, currentWindowHost(null));
    const mounting = runtime.mount(document.createElement("div"));
    await loadVlfs(vlfs);
    await expect(mounting).rejects.toThrow("KIRIKIRI_PROJECT_ENTRY_INVALID");
  });
});

function runtimeFailureEvent(transport: "error" | "unhandledrejection", error: WebAssembly.RuntimeError) {
  if (transport === "error") {
    return new ErrorEvent("error", { cancelable: true, error, message: error.message });
  }
  const event = new Event("unhandledrejection", { cancelable: true });
  Object.defineProperty(event, "reason", { value: error });
  return event;
}

function gamepadButton(pressed = false): GamepadButton {
  return { pressed, touched: pressed, value: pressed ? 1 : 0 };
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height, height, left, right: left + width, top, width, x: left, y: top,
    toJSON: () => ({}),
  };
}
