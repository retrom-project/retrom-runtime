import {gunzipSync, gzipSync} from "fflate";
import {describe, expect, it, vi} from "vitest";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {hostFixture} from "../../../tests/provider-adapter-fixture.js";
import type {EmulatorDefaultControls} from "./default-controls.js";

describe("Intellivision", () => {
  it.each([false, true])("preserves controls and checkpoint bytes with restore=%s", async (restoring) => {
    const coreId = "freeintv";
    const targetId = coreId.replaceAll("_", "-");
    const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === targetId);
    expect(target).toBeDefined();
    if (!target) {throw new Error("missing target");}
    expect(target.netplayPort).toBe(false);
    expect(target.discSwitch).toBe(false);
    expect(target.implementation.release).toBe("4.3.0-pre");
    const frame = document.createElement("iframe"); document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    runtimeWindow.Response = Response; runtimeWindow.fetch = fetch;
    const envelope = launchEnvelope(); envelope.runtime.targetId = targetId;
    const bytes = Uint8Array.of(1, 2, 3);
    const stored = gzipSync(bytes);
    if (restoring) {
      envelope.restore = {format: "emulatorjs-state-v1-storage-v1", sha256: "a".repeat(64),
        sizeBytes: stored.byteLength, url: "/runtime/restore"};
    }
    const implementation = target.implementation;
    const player = await createEmulatorJsPlayer(envelope, hostFixture({
      loadRestore: vi.fn(async () => restoring ? stored : null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
    }), {[implementation.coreAssetPath]: {sha256: implementation.coreSha256, sizeBytes: implementation.coreSizeBytes}});
    try {
      const mounting = player.mount(document.createElement("div"));
      const settled = mounting.catch((error: unknown) => error);
      await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
      expect(runtimeWindow.EJS_core).toBe(coreId);
      expect(runtimeWindow.EJS_defaultControls).toMatchObject({0: {
        4: {value2: "DPAD_UP"}, 5: {value2: "DPAD_DOWN"},
        6: {value2: "DPAD_LEFT"}, 7: {value2: "DPAD_RIGHT"},
        0: {value2: "BUTTON_2"}, 8: {value2: "BUTTON_1"},
      }});
      // A physical gamepad input must never trigger two native controls.
      // Keyboard bindings remain independent inputs to those controls.
      for (const controls of Object.values(runtimeWindow.EJS_defaultControls as EmulatorDefaultControls)) {
        const gamepadInputs = Object.values(controls).flatMap(({value2}) => value2 ? [value2] : []);
        expect(new Set(gamepadInputs).size).toBe(gamepadInputs.length);
      }
      let finishRestore: (() => void) | undefined;
      const loadStateAndWait = vi.fn(() => new Promise<void>((resolve) => {finishRestore = resolve;}));
      runtimeWindow.EJS_emulator = {gameManager: {getState: () => bytes, loadStateAndWait, toggleMainLoop: vi.fn()}};
      (runtimeWindow.EJS_ready as () => void)();
      (runtimeWindow.EJS_onGameStart as () => void)();
      if (restoring) {
        await vi.waitFor(() => expect(loadStateAndWait).toHaveBeenCalledWith(bytes));
        expect(player.getState()).toBe("MOUNTING");
        finishRestore?.();
      }
      expect(await settled).toBeUndefined();
      expect(player.getState()).toBe("RUNNING");
      const saved = await player.checkpoint();
      expect(gunzipSync(saved.bytes)).toEqual(Uint8Array.of(1, 2, 3));
      expect(saved).toMatchObject({format: "emulatorjs-state-v1-storage-v1"});
    } finally {await player.exit(); frame.remove();}
  });
});
