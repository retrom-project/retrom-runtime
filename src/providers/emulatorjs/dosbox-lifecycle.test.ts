import {expect, it, vi} from "vitest";

import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {ProviderContentOwner} from "../../provider/content-owner.js";
import type {ContentSessionClient} from "../../content-io/client.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";

it("starts DOS before requiring the game manager created by that startup", async () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
  runtimeWindow.Response = Response;
  runtimeWindow.fetch = fetch;
  const envelope = launchEnvelope();
  envelope.runtime.targetId = "dosbox-pure";
  envelope.runtime.capabilities.requiresThreads = true;
  envelope.session.purpose = "REVIEW_PREVIEW";
  const digest = "a".repeat(64);
  envelope.resources = [{kind: "FILE_TREE", role: "game", ordinal: 0,
    contentDigest: digest, indexUrl: `/runtime/content/game/${digest}/index.json`}];
  const contentSession = {open: vi.fn(async () => ({abi: "content-io-v1", sizeBytes: 1024,
    tryReadInto: (_offset: number, bytes: Uint8Array) => bytes.byteLength,
    readInto: vi.fn(), close: vi.fn(async () => {}),
  })), close: vi.fn(async () => {}), fail: vi.fn()} as unknown as ContentSessionClient;
  const startContent = vi.spyOn(ProviderContentOwner.prototype, "start").mockResolvedValue(contentSession);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1, files: [{
    path: "game.zip", url: `/runtime/content/game/${digest}/game.zip`, sizeBytes: 1024, sha256: digest, mediaType: "application/zip",
  }]}))));
  const implementation = emulatorJsProviderDefinition.targets.find(target => target.id === "dosbox-pure")!.implementation;
  const player = await createEmulatorJsPlayer(envelope, {
    loadRestore: vi.fn(async () => null),
    mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
    reportDiagnostic: vi.fn(), signal: new AbortController().signal,
  }, {
    [implementation.coreAssetPath]: {sha256: implementation.coreSha256, sizeBytes: implementation.coreSizeBytes},
  });
  let programReady = 0;
  const availabilityChanged = vi.fn();
  player.subscribe(event => {if (event.type === "CHECKPOINT_AVAILABILITY_CHANGED") {availabilityChanged(event.availability);}});
  try {
    const mounting = player.mount(document.createElement("div"));
    const mounted = mounting.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    const canvas = runtimeWindow.document.createElement("canvas");
    const enableShader = vi.fn(), changeSettingOption = vi.fn(), simulateInput = vi.fn();
    runtimeWindow.document.body.append(canvas);
    const instance: {downloadType: {rom: {dontExtractIfCore: string[]}}; gameManager?: object;
      canvas: HTMLCanvasElement; enableShader: typeof enableShader; changeSettingOption: typeof changeSettingOption;
      on: (event: string, listener: () => void) => void; startGame: () => void;
      downloadFile: (path: string, type: string) => Promise<unknown>} = {
      downloadType: {rom: {dontExtractIfCore: []}}, canvas, enableShader, changeSettingOption,
      on: () => {}, startGame: () => {}, downloadFile: async () => undefined,
    };
    runtimeWindow.EJS_emulator = instance;
    const start = runtimeWindow.document.createElement("button");
    start.className = "ejs_start_button";
    start.onclick = () => {
      instance.gameManager = {getState: () => Uint8Array.of(1), simulateInput,
        Module: {_retrom_dos_state_ready: () => programReady}};
      (runtimeWindow.EJS_onGameStart as () => void)();
    };
    runtimeWindow.document.body.append(start);
    (runtimeWindow.EJS_ready as () => void)();
    expect(await mounted).toBeNull();
    expect(instance.downloadType.rom.dontExtractIfCore).toContain("dosbox_pure");
    expect(player.getState()).toBe("RUNNING");
    canvas.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
    canvas.dispatchEvent(new KeyboardEvent("keyup", {key: "ArrowDown", bubbles: true}));
    expect(simulateInput.mock.calls).toEqual([[0, 5, 1], [0, 5, 0]]);
    expect(runtimeWindow.EJS_defaultOptions).toMatchObject({shader: "disabled"});
    expect(runtimeWindow.EJS_defaultControls).toMatchObject({0: {
      0: {value2: "BUTTON_1"}, 8: {value2: "BUTTON_2"}, 3: {value2: "START"}, 4: {value2: "DPAD_UP"},
    }});
    await player.setVideoMode("pixel");
    expect(canvas.style.getPropertyValue("image-rendering")).toBe("pixelated");
    expect(enableShader).not.toHaveBeenCalled();
    expect(changeSettingOption).not.toHaveBeenCalled();
    expect(player.getCheckpointAvailability()).toMatchObject({available: false, reason: "PROGRAM_SELECTION_REQUIRED"});
    programReady = 1;
    await vi.waitFor(() => expect(player.getCheckpointAvailability()).toEqual({available: true, reason: null}));
    expect(availabilityChanged).toHaveBeenLastCalledWith({available: true, reason: null});
    programReady = 0;
    await vi.waitFor(() => expect(player.getCheckpointAvailability()).toMatchObject({available: false, reason: "PROGRAM_SELECTION_REQUIRED"}));
    await player.exit();
    const eventCount = availabilityChanged.mock.calls.length;
    programReady = 1;
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(availabilityChanged).toHaveBeenCalledTimes(eventCount);
  } finally {
    await player.exit();
    frame.remove();
    startContent.mockRestore();
    vi.unstubAllGlobals();
  }
});
