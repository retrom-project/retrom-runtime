import {decodeStoredCheckpoint} from "../../provider/checkpoint-storage.js";
import {afterEach, describe, expect, it, vi} from "vitest";

import type {LaunchEnvelopeV1, RuntimeHostV1} from "../../provider/module-api.js";
import {projectProviderManifest} from "../../provider/manifest.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {createRuntime, providerApiVersion, providerId, providerVersion} from "./module.js";
import {hostFixture} from "../../../tests/provider-adapter-fixture.js";

const digest = "a".repeat(64);
const bundleDigest = "b".repeat(64);
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

describe("EmulatorJS Provider Module V1", () => {
  it("exports one stable Provider identity for both embedded EmulatorJS releases", async () => {
    expect({providerApiVersion, providerId, providerVersion}).toEqual({
      providerApiVersion: 1,
      providerId: "emulatorjs",
      providerVersion: "0.0.0-dev",
    });
    const envelope = launchEnvelope();
    vi.stubGlobal("__RETROM_PROVIDER_ASSET_INDEX__", {
      "assets/4.2.3/data/cores/fceumm-wasm.data": {
        sha256: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493",
        sizeBytes: 1054015,
      },
    });
    expect((await createRuntime(envelope, hostFixture())).getState()).toBe("CREATED");
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
    expect(runtimeWindow.EJS_DEBUG_XX).toBe(false);
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
    const callEvent = vi.fn();
    const RuntimeUint8Array = runtimeWindow.Uint8Array as Uint8ArrayConstructor;
    const crossRealmState = new RuntimeUint8Array([1, 2]);
    runtimeWindow.EJS_emulator = {
      canvas: document.createElement("canvas"),
      gameManager: {getFrameNum: () => 42, getState: () => crossRealmState, toggleMainLoop},
      callEvent,
      on: vi.fn(),
      paused: false,
      setVolume: vi.fn(),
    };
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;
    expect(player.getFrameCount()).toBe(42);
    const focus = vi.spyOn(player.getCanvas()!, "focus");
    await player.pause();
    const saved = await player.checkpoint();
    expect(saved.format).toBe("emulatorjs-state-v1-storage-v1");
    expect(await decodeStoredCheckpoint(saved.bytes, saved.format, 268435456)).toEqual(new Uint8Array([1, 2]));
    expect(player.getState()).toBe("PAUSED");
    expect(toggleMainLoop.mock.calls).toEqual([[false]]);
    expect(focus).not.toHaveBeenCalled();
    await player.resume();
    expect(toggleMainLoop).toHaveBeenLastCalledWith(true);
    expect(focus).toHaveBeenCalledWith({preventScroll: true});
    vi.useFakeTimers();
    const exiting = player.exit();
    await vi.advanceTimersByTimeAsync(1_100);
    await exiting;
    expect(callEvent).toHaveBeenCalledTimes(1);
    expect(callEvent).toHaveBeenCalledWith("exit");
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
      ["pixel", "retrom-passthrough", "pixelated"],
      ["adaptive-sharpen", "retrom-adaptive-sharpen", "auto"],
      ["smooth", "sabr", "auto"],
      ["original", "retrom-passthrough", "auto"],
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

function gamepad(index: number, select: boolean, start: boolean) {
  const buttons = Array.from({length: 16}, () => ({pressed: false, touched: false, value: 0}));
  buttons[8] = {pressed: select, touched: select, value: select ? 1 : 0};
  buttons[9] = {pressed: start, touched: start, value: start ? 1 : 0};
  return {
    axes: [0.25, -0.5], buttons, connected: true, id: `pad-${index}`,
    index, mapping: "standard" as const, timestamp: 1,
  };
}
