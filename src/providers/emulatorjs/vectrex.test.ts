import {gunzipSync} from "fflate";
import {expect, it, vi} from "vitest";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {hostFixture} from "../../../tests/provider-adapter-fixture.js";
import type {EmulatorDefaultControls} from "./default-controls.js";

it("loads VecX with directional and four-button input and a compressed instant checkpoint", async () => {
  const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === "vecx");
  expect(target).toBeDefined();
  if (!target) {throw new Error("missing Vectrex target");}
  expect(target).toMatchObject({discSwitch: false, netplayPort: false});
  const frame = document.createElement("iframe"); document.body.append(frame);
  const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
  runtimeWindow.Response = Response; runtimeWindow.fetch = fetch;
  const envelope = launchEnvelope(); envelope.runtime.targetId = "vecx";
  const implementation = target.implementation;
  const player = await createEmulatorJsPlayer(envelope, hostFixture({
    mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
  }), {[implementation.coreAssetPath]: {sha256: implementation.coreSha256, sizeBytes: implementation.coreSizeBytes}});
  try {
    const mounted = player.mount(document.createElement("div"));
    const settled = mounted.catch((error: unknown) => error);
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    expect(runtimeWindow.EJS_core).toBe("vecx");
    expect(runtimeWindow.EJS_defaultControls).toMatchObject({0: {
      4: {value2: "DPAD_UP"}, 5: {value2: "DPAD_DOWN"},
      6: {value2: "DPAD_LEFT"}, 7: {value2: "DPAD_RIGHT"},
      0: {value2: "BUTTON_2"}, 8: {value2: "BUTTON_1"},
      1: {value2: "BUTTON_4"}, 9: {value2: "BUTTON_3"},
    }});
    for (const controls of Object.values(runtimeWindow.EJS_defaultControls as EmulatorDefaultControls)) {
      const inputs = Object.values(controls).flatMap(({value2}) => value2 ? [value2] : []);
      expect(new Set(inputs).size).toBe(inputs.length);
    }
    runtimeWindow.EJS_emulator = {gameManager: {getState: () => Uint8Array.of(4, 3, 2, 1)}};
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    expect(await settled).toBeUndefined();
    const checkpoint = await player.checkpoint();
    expect(checkpoint.format).toBe("emulatorjs-state-v1-storage-v1");
    expect(gunzipSync(checkpoint.bytes)).toEqual(Uint8Array.of(4, 3, 2, 1));
  } finally {await player.exit(); frame.remove();}
});
