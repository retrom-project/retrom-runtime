import {gunzipSync, gzipSync} from "fflate";
import {describe, expect, it, vi} from "vitest";

import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {hostFixture} from "../../../tests/provider-adapter-fixture.js";
import {projectProviderManifest} from "../../provider/manifest.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import type {EmulatorDefaultControls} from "./default-controls.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";

describe("bsnes alternative SNES core", () => {
  it("declares the pinned 4.3.0-pre single-thread core with an instant checkpoint", () => {
    const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === "bsnes");
    expect(target?.implementation).toMatchObject({release: "4.3.0-pre", runtimeCore: "bsnes",
      artifactFlavor: "OVERRIDE", contentKinds: ["SINGLE_FILE"], startupActions: []});
    const declaration = projectProviderManifest(emulatorJsProviderDefinition).targets.find((entry) => entry.id === "bsnes");
    expect(declaration?.capabilities).toMatchObject({standardGamepad: true, checkpoint: true,
      requiresThreads: false, netplayPort: false, discSwitch: false});
    expect(declaration?.checkpoint).toMatchObject({maxBytes: 268435456,
      writeFormat: "bsnes-state-v1-storage-v1"});
    expect(declaration?.assetPaths).toContain("assets/4.3.0-pre/data/cores/bsnes-wasm.data");
    expect(declaration?.assetPaths).toContain("assets/4.3.0-pre/data/cores/reports/bsnes.json");
  });

  it("does not declare Snes9x snapshots compatible with bsnes in either direction", () => {
    const targets = projectProviderManifest(emulatorJsProviderDefinition).targets;
    const bsnes = targets.find((entry) => entry.id === "bsnes")!.checkpoint!;
    const snes9x = targets.find((entry) => entry.id === "snes9x")!.checkpoint!;
    expect(bsnes.readFormats).not.toContain(snes9x.writeFormat);
    expect(snes9x.readFormats).not.toContain(bsnes.writeFormat);
  });

  it.each([false, true])("preserves SNES input and checkpoint bytes (restore=%s)", async (restore) => {
    const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === "bsnes");
    expect(target).toBeDefined();
    if (!target) {throw new Error("missing bsnes target");}
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    runtimeWindow.fetch = fetch;
    runtimeWindow.Response = Response;
    const nativeState = Uint8Array.of(1, 2, 3, 4);
    const storedState = gzipSync(nativeState);
    const envelope = launchEnvelope();
    envelope.runtime.targetId = "bsnes";
    envelope.runtime.capabilities.netplayPort = false;
    if (restore) {
      envelope.restore = {format: "bsnes-state-v1-storage-v1", sha256: "a".repeat(64),
        sizeBytes: storedState.byteLength, url: "/runtime/restore"};
    }
    envelope.runtime.checkpoint = projectProviderManifest(emulatorJsProviderDefinition).targets.find((entry) => entry.id === "bsnes")!.checkpoint;
    const {coreAssetPath, coreSha256, coreSizeBytes} = target.implementation;
    const player = await createEmulatorJsPlayer(envelope, hostFixture({
      loadRestore: vi.fn(async () => restore ? storedState : null),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
    }), {[coreAssetPath]: {sha256: coreSha256, sizeBytes: coreSizeBytes}});
    try {
      const mounting = player.mount(document.createElement("div"));
      await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
      expect(runtimeWindow.EJS_core).toBe("bsnes");
      expect(runtimeWindow.EJS_defaultControls).toMatchObject({0: {
        3: {value2: "START"}, 4: {value2: "DPAD_UP"}, 5: {value2: "DPAD_DOWN"},
        6: {value2: "DPAD_LEFT"}, 7: {value2: "DPAD_RIGHT"},
        0: {value: "j", value2: "BUTTON_2"}, 8: {value: "k", value2: "BUTTON_1"},
      }});
      for (const controls of Object.values(runtimeWindow.EJS_defaultControls as EmulatorDefaultControls)) {
        const bindings = Object.values(controls).flatMap(({value2}) => value2 ? [value2] : []);
        expect(new Set(bindings).size).toBe(bindings.length);
      }
      const loadState = vi.fn();
      runtimeWindow.EJS_emulator = {gameManager: {getState: async () => nativeState, loadState, toggleMainLoop: vi.fn()}};
      (runtimeWindow.EJS_ready as () => void)();
      (runtimeWindow.EJS_onGameStart as () => void)();
      await mounting;
      if (restore) {expect(loadState).toHaveBeenCalledExactlyOnceWith(nativeState);}
      else {expect(loadState).not.toHaveBeenCalled();}
      expect(player.getState()).toBe("RUNNING");
      const saved = await player.checkpoint();
      expect(saved.format).toBe("bsnes-state-v1-storage-v1");
      expect(gunzipSync(saved.bytes)).toEqual(nativeState);
    } finally {
      await player.exit();
      expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).toBeNull();
      frame.remove();
    }
  });
});
