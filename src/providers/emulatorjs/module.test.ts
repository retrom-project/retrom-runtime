import {afterEach, describe, expect, it, vi} from "vitest";

import type {LaunchEnvelopeV1, RuntimeHostV1} from "../../provider/module-api.js";
import {projectProviderManifest} from "../../provider/manifest.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {validateEmulatorJsNetplayProfile} from "./netplay-profile.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {providerApiVersion, providerId, providerVersion, validateLaunchRequest} from "./module.js";

const digest = "a".repeat(64);
const bundleDigest = "b".repeat(64);
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

describe("EmulatorJS Provider Module V1", () => {
  it("exports one stable Provider identity for both embedded EmulatorJS releases", () => {
    expect({providerApiVersion, providerId, providerVersion}).toEqual({
      providerApiVersion: 1,
      providerId: "emulatorjs",
      providerVersion: "2.1.0",
    });
    const envelope = launchEnvelope();
    expect(validateLaunchRequest(envelope)).toBe(envelope);
  });

  it("keeps mount pending until the real EmulatorJS game-start barrier", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(launchEnvelope(), host, {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });

    let settled = false;
    const mounting = player.mount(document.createElement("div"));
    void mounting.finally(() => {settled = true;});
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    expect(player.getState()).toBe("MOUNTING");
    expect(settled).toBe(false);

    runtimeWindow.EJS_emulator = {gameManager: {}};
    (runtimeWindow.EJS_ready as () => void)();
    await Promise.resolve();
    expect(player.getState()).toBe("MOUNTING");
    expect(settled).toBe(false);

    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;
    expect(player.getState()).toBe("RUNNING");
  });

  it("resumes the main loop after an initial checkpoint restore", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    runtimeWindow.fetch = vi.fn(async () => new Response("ok"));
    const envelope = launchEnvelope();
    envelope.restore = {
      format: "emulatorjs-state-v1", sha256: digest, sizeBytes: 3, url: "/runtime/session/restore",
    };
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => Uint8Array.of(1, 2, 3)),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(envelope, host, {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });
    const toggleMainLoop = vi.fn();
    const loadExplicitStateAndWait = vi.fn(async () => undefined);
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    runtimeWindow.EJS_emulator = {
      gameManager: {loadExplicitStateAndWait, toggleMainLoop}, paused: true,
    };
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;

    expect(loadExplicitStateAndWait).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(toggleMainLoop).toHaveBeenLastCalledWith(true);
    expect(player.getState()).toBe("RUNNING");
  });

  it("rejects unsupported operations with the stable capability error code", async () => {
    const player = await createEmulatorJsPlayer(launchEnvelope(), {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => {throw new Error("unused");}),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    }, {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });

    await expect(player.getDiscState()).rejects.toMatchObject({
      code: "PLAYER_RUNTIME_CAPABILITY_UNSUPPORTED",
    });
  });

  it("fails once and removes scoped globals when the loader fails", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(launchEnvelope(), host, {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });
    const events: string[] = [];
    player.subscribe((event) => events.push(event.type));

    const mounting = player.mount(document.createElement("div"));
    const loader = await vi.waitFor(() => {
      const value = runtimeWindow.document.querySelector<HTMLScriptElement>("script[data-retrom-loader]");
      expect(value).not.toBeNull();
      return value!;
    });
    loader.dispatchEvent(new Event("error"));
    loader.dispatchEvent(new Event("error"));

    await expect(mounting).rejects.toMatchObject({code: "PLAYER_RUNTIME_LOADER_FAILED"});
    expect(events.filter((event) => event === "FATAL_ERROR")).toHaveLength(1);
    expect(player.getState()).toBe("FAILED");
    expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).toBeNull();
    expect(runtimeWindow.EJS_core).toBeUndefined();
    await Promise.all([player.exit(), player.exit()]);
    expect(player.getState()).toBe("FAILED");
  });

  it("projects a target declaration and scoped resources into an isolated EJS frame", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(launchEnvelope(), host, {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    expect(runtimeWindow.EJS_core).toBe("fceumm");
    expect(runtimeWindow.EJS_gameUrl).toBe("/runtime/content/game/game.nes");
    expect(runtimeWindow.EJS_pathtodata).toBe(`/runtime/providers/emulatorjs/${bundleDigest}/assets/4.2.3/data/`);
    expect(runtimeWindow.EJS_paths).toEqual({
      "fceumm-wasm.data": `/runtime/providers/emulatorjs/${bundleDigest}/assets/4.2.3/data/cores/fceumm-wasm.data`,
    });
    expect(runtimeWindow.EJS_defaultOptions).toMatchObject({webgl2Enabled: "enabled"});
    const defaultControls = runtimeWindow.EJS_defaultControls as Record<
      number, Record<number, {value: string; value2?: string}>
    >;
    expect(Object.keys(defaultControls)).toHaveLength(4);
    expect(Object.keys(defaultControls[0])).toHaveLength(30);
    expect(defaultControls[0]).toMatchObject({
      0: {value: "j", value2: "BUTTON_2"},
      2: {value: "5", value2: "SELECT"},
      3: {value: "1", value2: "START"},
      8: {value: "k", value2: "BUTTON_1"},
    });
    expect(defaultControls[1]).toMatchObject({
      0: {value: "numpad 1"},
      2: {value: ""},
      3: {value: "2"},
      8: {value: "numpad 2"},
    });
    expect(runtimeWindow.EJS_shaders).toMatchObject({
      "retrom-sharp-bilinear": {shader: {type: "text"}},
      "retrom-adaptive-sharpen": {shader: {type: "text"}},
    });
    expect(runtimeWindow.document.querySelector<HTMLScriptElement>("script[data-retrom-loader]")?.src)
      .toContain(`/runtime/providers/emulatorjs/${bundleDigest}/assets/4.2.3/data/loader.js`);

    const toggleMainLoop = vi.fn();
    const RuntimeUint8Array = runtimeWindow.Uint8Array as Uint8ArrayConstructor;
    const crossRealmState = new RuntimeUint8Array([1, 2]);
    runtimeWindow.EJS_emulator = {
      canvas: document.createElement("canvas"),
      gameManager: {getFrameNum: () => 42, getState: () => crossRealmState, toggleMainLoop},
      on: vi.fn(),
      paused: false,
      setVolume: vi.fn(),
    };
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;
    expect(player.getFrameCount()).toBe(42);
    await player.pause();
    await expect(player.checkpoint()).resolves.toEqual({
      bytes: new Uint8Array([1, 2]), format: "emulatorjs-state-v1", metadata: null,
    });
    expect(player.getState()).toBe("PAUSED");
    expect(toggleMainLoop.mock.calls).toEqual([[false]]);
    await player.resume();
    expect(toggleMainLoop).toHaveBeenLastCalledWith(true);
    await player.exit();
    expect(player.getState()).toBe("EXITED");
  });

  it("captures the displayed EmulatorJS output instead of raw canvas readback", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(launchEnvelope(), host, {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    expect(runtimeWindow.document.documentElement.classList.contains("retrom-native-menu-locked")).toBe(true);
    expect(runtimeWindow.document.querySelector("style[data-retrom-player-frame]")).not.toBeNull();
    const displayed = new Blob(["displayed"], {type: "image/png"});
    const takeScreenshot = vi.fn(async () => ({blob: displayed, format: "png"}));
    runtimeWindow.EJS_emulator = {
      canvas: document.createElement("canvas"),
      capture: {photo: {format: "png", source: "canvas", upscale: 2}},
      gameManager: {},
      takeScreenshot,
    };
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;

    const screenshot = await player.screenshot();
    expect(screenshot).not.toBe(displayed);
    expect(screenshot).toMatchObject({size: displayed.size, type: "image/png"});
    expect(new Uint8Array(await screenshot.arrayBuffer()))
      .toEqual(new Uint8Array(await displayed.arrayBuffer()));
    expect(takeScreenshot).toHaveBeenCalledWith("canvas", "png", 2);
  });

  it("owns volume, pause, video modes, debug access and native settings", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(launchEnvelope(), host, {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    const canvas = runtimeWindow.document.createElement("canvas");
    const controlMenu = runtimeWindow.document.createElement("div");
    controlMenu.style.display = "none";
    const settingsMenu = runtimeWindow.document.createElement("div");
    const displayButton = runtimeWindow.document.createElement("button");
    displayButton.className = "ejs_settings_main_bar";
    displayButton.textContent = "Graphics Settings";
    const coreButton = runtimeWindow.document.createElement("button");
    coreButton.className = "ejs_settings_main_bar";
    coreButton.textContent = "Backend Core Options";
    settingsMenu.append(displayButton, coreButton);
    const changeSettingOption = vi.fn();
    const closeSettingsMenu = vi.fn();
    const menu = {close: vi.fn(), open: vi.fn()};
    const setVolume = vi.fn();
    const toggleMainLoop = vi.fn();
    displayButton.addEventListener("click", () => toggleMainLoop(true));
    runtimeWindow.EJS_emulator = {
      canvas, changeSettingOption, closeSettingsMenu, controlMenu,
      gameManager: {getFrameNum: () => 314, toggleMainLoop}, menu,
      paused: false, setVolume, settingsMenu,
    };
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;

    await player.setVolume(0.35);
    expect(setVolume).toHaveBeenCalledWith(0.35);
    await expect(player.setVolume(Number.NaN)).rejects.toMatchObject({code: "PLAYER_RUNTIME_CONTRACT_INVALID"});
    for (const [mode, shader, imageRendering] of [
      ["sharp-bilinear", "retrom-sharp-bilinear", "pixelated"],
      ["pixel", "disabled", "pixelated"],
      ["adaptive-sharpen", "retrom-adaptive-sharpen", "auto"],
      ["smooth", "sabr", "auto"],
      ["original", "disabled", "auto"],
    ] as const) {
      await player.setVideoMode(mode);
      expect(changeSettingOption).toHaveBeenLastCalledWith("shader", shader);
      expect(canvas.style.getPropertyValue("image-rendering")).toBe(imageRendering);
      expect(canvas.style.getPropertyPriority("image-rendering")).toBe("important");
    }
    await player.pause();
    await player.pause();
    await player.resume();
    await player.resume();
    expect(toggleMainLoop.mock.calls).toEqual([[false], [true]]);
    expect(player.getFrameCount()).toBe(314);
    expect(player.getCanvas()).toBe(canvas);

    await player.openNativeSettings("controls");
    expect(controlMenu.style.display).toBe("");
    await player.pause();
    await player.openNativeSettings("display");
    expect(menu.open).toHaveBeenLastCalledWith(true);
    expect(toggleMainLoop).toHaveBeenLastCalledWith(false);
    expect(player.getState()).toBe("PAUSED");
    expect(runtimeWindow.document.documentElement.classList.contains("retrom-native-settings-open")).toBe(true);
    await player.openNativeSettings("core");
    await player.closeNativeSettings();
    expect(controlMenu.style.display).toBe("none");
    expect(closeSettingsMenu).toHaveBeenCalled();
    expect(menu.close).toHaveBeenCalled();
    expect(runtimeWindow.document.documentElement.classList.contains("retrom-native-settings-open")).toBe(false);
  });

  it("initializes, reads and switches a declared multi-disc runtime with readback", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(yabauseEnvelope(), host, {
      "assets/4.2.3/data/cores/yabause-wasm.data": {
        sha256: "ab253ac263bd98e3124e2ca45ff581e97673426ed06ecec0025333060cd8127c",
        sizeBytes: 991166,
      },
    });
    const events: string[] = [];
    player.subscribe((event) => events.push(event.type));
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    let currentDisc = 0;
    const calls: string[] = [];
    const instance = {
      gameManager: {
        getCurrentDisk: () => currentDisc,
        getDiskCount: () => 2,
        setCurrentDisk: (index: number) => {calls.push(`disc:${index}`); currentDisc = index;},
        toggleMainLoop: (running: boolean) => calls.push(`loop:${running}`),
      },
    };
    runtimeWindow.EJS_emulator = instance;
    (runtimeWindow.EJS_ready as () => void)();
    expect(instance).toMatchObject({allSettings: {}});
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;
    expect(calls).toEqual(["loop:false", "disc:1", "loop:true"]);
    await expect(player.getDiscState()).resolves.toEqual({
      count: 2, currentIndex: 1, labels: ["Disc A", "Disc B"],
    });

    calls.length = 0;
    await expect(player.switchDisc(0)).resolves.toEqual({
      count: 2, currentIndex: 0, labels: ["Disc A", "Disc B"],
    });
    expect(calls).toEqual(["loop:false", "disc:0", "loop:true"]);
    expect(events.filter((event) => event === "DISC_CHANGED")).toHaveLength(1);
    calls.length = 0;
    await player.switchDisc(0);
    expect(calls).toEqual([]);
    await expect(player.switchDisc(2)).rejects.toMatchObject({code: "PLAYER_RUNTIME_CONTRACT_INVALID"});
  });

  it("installs, updates and removes the scoped immersive input filter", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    const first = gamepad(0, true, false);
    const second = gamepad(1, false, true);
    const nativeGetGamepads = vi.fn(() => [first, second] as unknown as Gamepad[]);
    Object.defineProperty(runtimeWindow.navigator, "getGamepads", {
      configurable: true, value: nativeGetGamepads, writable: true,
    });
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(launchEnvelope(), host, {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });
    await player.setInputFilter({activeGamepadIndex: 0, suppressInput: false});
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    const installed = runtimeWindow.navigator.getGamepads;
    expect(installed).not.toBe(nativeGetGamepads);
    let filtered = installed.call(runtimeWindow.navigator);
    expect(filtered[0]?.buttons[8]?.pressed).toBe(false);
    expect(filtered[1]).toBe(second);

    await player.setInputFilter({activeGamepadIndex: 0, suppressInput: true});
    filtered = runtimeWindow.navigator.getGamepads();
    expect(filtered.flatMap((pad) => [...(pad?.buttons ?? [])]).every((button) => !button.pressed && button.value === 0))
      .toBe(true);
    expect(filtered.flatMap((pad) => [...(pad?.axes ?? [])]).every((axis) => axis === 0)).toBe(true);
    await expect(player.setInputFilter({activeGamepadIndex: -1, suppressInput: false}))
      .rejects.toMatchObject({code: "PLAYER_RUNTIME_CONTRACT_INVALID"});
    await player.setInputFilter(null);
    expect(runtimeWindow.navigator.getGamepads).toBe(nativeGetGamepads);

    runtimeWindow.EJS_emulator = {gameManager: {}};
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;
    await player.setInputFilter({activeGamepadIndex: 0, suppressInput: true});
    await player.exit();
    expect(runtimeWindow.navigator.getGamepads).toBe(nativeGetGamepads);
  });

  it("exposes the standard netplay port and restores native hooks on close", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    runtimeWindow.fetch = vi.fn(async () => new Response("ok"));
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(),
      signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(netplayEnvelope("fceumm"), host, {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    expect(Object.getOwnPropertyDescriptor(runtimeWindow, "EJS_GameManager")?.set).toBeTypeOf("function");
    const publicInput = vi.fn();
    const nativeInput = vi.fn();
    let currentState = raState([1, 2, 3]);
    let currentFrame = 9;
    const runNetplayFrame = vi.fn(async () => ++currentFrame);
    const manager = {
      functions: {simulateInput: nativeInput},
      getFrameNum: () => currentFrame,
      getState: () => new (runtimeWindow.Uint8Array as Uint8ArrayConstructor)(currentState),
      loadStateAndWait: vi.fn(async (state: Uint8Array) => {
        currentState = new Uint8Array(state);
        return {byteExact: true};
      }),
      runNetplayFrame,
      simulateInput: publicInput,
      toggleMainLoop: vi.fn(),
    };
    runtimeWindow.EJS_emulator = {gameManager: manager, muted: false, paused: false, volume: 0.7};
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;

    const port = await player.getNetplayPort();
    expect(port.controlCount).toBe(24);
    manager.simulateInput(0, 3, 1);
    expect(port.sampleLocalControls()[3]).toBe(1);
    const controls = new Int16Array(96);
    controls[6] = 1;
    controls[31] = -1;
    await port.runFrame(controls, 0, false);
    expect(nativeInput).toHaveBeenCalledTimes(96);
    expect(nativeInput).toHaveBeenCalledWith(0, 6, 1);
    expect(nativeInput).toHaveBeenCalledWith(1, 7, -1);
    await expect(port.captureState(1)).resolves.toEqual(currentState);
    await expect(port.loadStateAndWait(raState([4, 5, 6]), 1)).resolves.toBeUndefined();
    await expect(port.pauseAtBoundary()).resolves.toBe(11);
    port.resetLocalControls();
    expect([...port.sampleLocalControls()]).toEqual(Array(24).fill(0));
    await port.close();
    manager.simulateInput(0, 3, 0);
    expect(publicInput).toHaveBeenCalledWith(0, 3, 0);
    await player.exit();
    expect(Object.getOwnPropertyDescriptor(runtimeWindow, "EJS_GameManager")).toBeUndefined();
  });

  it("binds netplay only to the current session bundle and rejects removed identity fields", () => {
    const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === "fceumm");
    if (!target) {throw new Error("fceumm target fixture missing");}
    const implementation = target.implementation as Parameters<typeof validateEmulatorJsNetplayProfile>[1];
    const current = netplayEnvelope("fceumm");
    expect(validateEmulatorJsNetplayProfile(current, implementation)).toMatchObject({
      profileId: "fceumm-423-v1",
    });

    const differentBundle = structuredClone(current);
    if (!differentBundle.netplay) {throw new Error("netplay fixture missing");}
    differentBundle.netplay.profile.bundleSha256 = "c".repeat(64);
    expect(() => validateEmulatorJsNetplayProfile(differentBundle, implementation))
      .toThrow("PLAYER_NETPLAY_PROFILE_INVALID");

    const legacy = structuredClone(current);
    if (!legacy.netplay) {throw new Error("netplay fixture missing");}
    legacy.netplay.profile.gameVariantRevisionId = "01980000-0000-7000-8000-000000000006";
    expect(() => validateEmulatorJsNetplayProfile(legacy, implementation))
      .toThrow("PLAYER_NETPLAY_PROFILE_INVALID");
  });

});

function yabauseEnvelope(): LaunchEnvelopeV1 {
  const envelope = launchEnvelope();
  const target = projectProviderManifest(emulatorJsProviderDefinition).targets.find((entry) => entry.id === "yabause");
  if (!target) {throw new Error("yabause target fixture missing");}
  return {
    ...envelope,
    resources: [{
      kind: "ROM_BLOB", ordinal: 0, rangeRequired: false, role: "game",
      sha256: digest, sizeBytes: 128, url: "/runtime/content/game/playlist.m3u",
    }, {
      entries: [
        {index: 0, label: "Disc A", sha256: "c".repeat(64), sizeBytes: 128, url: "/runtime/content/discs/a.chd"},
        {index: 1, label: "Disc B", sha256: "d".repeat(64), sizeBytes: 256, url: "/runtime/content/discs/b.chd"},
      ],
      initialDiscIndex: 1, kind: "MULTI_DISC", ordinal: 0, role: "discs",
    }],
    runtime: {
      ...envelope.runtime,
      capabilities: target.capabilities,
      checkpoint: target.checkpoint,
      targetId: "yabause",
    },
    targetOptions: {dosEntryPath: null, initialDiscIndex: 1},
  };
}

function netplayEnvelope(targetId: "fceumm"): LaunchEnvelopeV1 {
  const envelope = launchEnvelope();
  return {
    ...envelope,
    netplay: {
      profile: {
        bundleSha256: envelope.runtime.bundleSha256,
        canonicalHistoryFrames: 600, checkpointEveryFrames: 120, controlCount: 24,
        coreId: "fceumm", dependencySnapshotDigest: "e".repeat(64),
        maxPlayers: 2, maxPredictionFrames: 8, maxRollbackFrames: 120, maxStateBytes: 1_048_576,
        platformIds: ["nes"],
        profileId: "fceumm-423-v1", protocolVersion: "retrom-netplay-v2",
        providerId: "emulatorjs", schemaVersion: 2, sourceManifestDigest: "f".repeat(64),
        targetId,
      },
      roomId: "fixture-room", sessionId: "018f0f31-26fe-7a31-9d61-4ec92f16d4c4",
      socketUrl: "wss://runtime.example.test/netplay", playerNo: 1,
    },
    runtime: {...envelope.runtime, targetId},
    session: {...envelope.session, mode: "NETPLAY"},
  };
}

function gamepad(index: number, select: boolean, start: boolean) {
  const buttons = Array.from({length: 16}, () => ({pressed: false, touched: false, value: 0}));
  buttons[8] = {pressed: select, touched: select, value: select ? 1 : 0};
  buttons[9] = {pressed: start, touched: start, value: start ? 1 : 0};
  return {
    axes: [0.25, -0.5], buttons, connected: true, id: `pad-${index}`,
    index, mapping: "standard" as const, timestamp: 1,
  };
}

function raState(core: number[]) {
  const corePadded = (core.length + 7) & ~7;
  const state = new Uint8Array(8 + 8 + corePadded + 8);
  state.set(new TextEncoder().encode("RASTATE"));
  state[7] = 1;
  state.set(new TextEncoder().encode("MEM "), 8);
  new DataView(state.buffer).setUint32(12, core.length, true);
  state.set(core, 16);
  state.set(new TextEncoder().encode("END "), 16 + corePadded);
  return state;
}
