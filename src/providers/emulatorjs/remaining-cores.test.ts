import {describe, expect, it, vi} from "vitest";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {hostFixture} from "../../../tests/provider-adapter-fixture.js";

const coreIds = ["81", "cap32", "crocods", "vice_xpet", "vice_xplus4", "same_cdi", "vice_x64"];
describe("remaining EmulatorJS cores", () => {
  it.each(coreIds)("mounts %s through the declared loader and preserves checkpoint bytes", async (coreId) => {
    const targetId = coreId.replaceAll("_", "-");
    const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === targetId);
    expect(target).toBeDefined();
    if (!target) {throw new Error("missing target");}
    expect(target.netplayPort).toBe(false);
    expect(target.discSwitch).toBe(false);
    expect(target.implementation.release).toBe("4.2.3");
    const frame = document.createElement("iframe"); document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    runtimeWindow.Response = Response; runtimeWindow.fetch = fetch;
    const envelope = launchEnvelope(); envelope.runtime.targetId = targetId;
    const implementation = target.implementation;
    const player = await createEmulatorJsPlayer(envelope, hostFixture({
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
      runtimeWindow.EJS_emulator = {gameManager: {getState: () => Uint8Array.of(1, 2, 3)}};
      (runtimeWindow.EJS_ready as () => void)();
      (runtimeWindow.EJS_onGameStart as () => void)(); expect(await settled).toBeUndefined();
      expect(player.getState()).toBe("RUNNING");
      const saved = await player.checkpoint();
      expect(saved.bytes).toEqual(Uint8Array.of(1, 2, 3));
      expect(saved).toMatchObject({format: "emulatorjs-state-v1"});
    } finally {await player.exit(); frame.remove();}
  });
});
