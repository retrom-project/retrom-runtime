import "../../../tests/emulatorjs-content-fixture.js";
import {expect, it, vi} from "vitest";

import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {hostFixture} from "../../../tests/provider-adapter-fixture.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";

it.each([
  ["genesis-plus-gx", "segaCD", "game.md"],
  ["picodrive", "segaCD", "game.32x"],
  ["genesis-plus-gx-wide", "segaMD", "game.smd"],
  ["fceumm", undefined, "game.nes"],
  ["desmume", "generic", "game.nds"],
  ["desmume2015", "generic", "game.nds"],
  ["melonds", "generic", "game.nds"],
  ["genesis-plus-gx", "segaGG", "game.GG"],
  ["genesis-plus-gx", "segaMS", "game.sg"],
  ["cap32", undefined, "game.cpr"],
  ["theodore", undefined, "game.k7", "Bomb Jacques MO5", "TO8D"],
  ["theodore", undefined, "game.k7", "Display title TO7", undefined],
] as const)("selects the explicit controller layout before %s builds its input map", async (targetId, scheme, filename, title?: string, model?: string) => {
  const target = emulatorJsProviderDefinition.targets.find((candidate) => candidate.id === targetId)!;
  const implementation = target.implementation;
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
  runtimeWindow.Response = Response;
  runtimeWindow.fetch = fetch;
  const envelope = launchEnvelope();
  envelope.runtime.targetId = targetId;
  if (title) {envelope.session.title = title;}
  if (model) {envelope.targetOptions.thomsonModel = model;}
  const game = envelope.resources[0];
  if (game.kind !== "ROM_BLOB") {throw new Error("ROM fixture required");}
  game.url = `/runtime/content/game/${filename}?download=1`;
  const player = await createEmulatorJsPlayer(envelope, hostFixture({
    mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
  }), {
    [implementation.coreAssetPath]: {sha256: implementation.coreSha256, sizeBytes: implementation.coreSizeBytes},
  });
  try {
    const mounting = player.mount(document.createElement("div"));
    const settled = mounting.catch(() => undefined);
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    expect(runtimeWindow.EJS_controlScheme).toBe(scheme);
    if (filename === "game.cpr") {
      expect(runtimeWindow.EJS_defaultOptions).toMatchObject({cap32_model: "6128+ (experimental)", cap32_gfx_colors: "24bit"});
    }
    if (targetId === "theodore") {
      expect((runtimeWindow.EJS_defaultOptions as Record<string, unknown>).theodore_rom).toBe(model);
    }
    expect(runtimeWindow.EJS_defaultControls).toMatchObject({
      0: {1: {value: "l", value2: targetId === "theodore" ? "BUTTON_1" : "BUTTON_4"}, 3: {value: "1", value2: "START"}},
    });
    if (targetId === "theodore") {
      expect(runtimeWindow.EJS_defaultControls).toMatchObject({0: {
        1: {value2: "BUTTON_1"}, 8: {value2: "BUTTON_4"},
      }});
    }
    if (["desmume", "desmume2015", "melonds"].includes(targetId)) {
      const controls = (runtimeWindow.EJS_defaultControls as Record<number, Record<number, {value: string; value2?: string}>>)[0];
      expect(controls).toMatchObject({13: {value2: "RIGHT_BOTTOM_SHOULDER"}, 15: {value2: "RIGHT_STICK"},
        20: {value2: "RIGHT_STICK_X:+1"}, 21: {value2: "RIGHT_STICK_X:-1"},
        22: {value2: "RIGHT_STICK_Y:+1"}, 23: {value2: "RIGHT_STICK_Y:-1"}});
      const buttons = Object.values(controls).flatMap(control => control.value2 ? [control.value2] : []);
      expect(new Set(buttons).size).toBe(buttons.length);
      expect(controls[8].value).toBe("k");
      if (targetId !== "melonds") {expect(runtimeWindow.EJS_defaultOptions).toMatchObject({desmume_pointer_device_r: "emulated"});}
    }
    const instance = {
      gameManager: {getState: () => Uint8Array.of(1)},
      gamepad: {gamepads: [{id: "Already connected pad", index: 0}]},
      gamepadSelection: ["", "", "", ""],
      updateGamepadLabels: vi.fn(),
    };
    runtimeWindow.EJS_emulator = instance;
    (runtimeWindow.EJS_ready as () => void)();
    expect(instance.gamepadSelection).toEqual(["Already connected pad_0", "", "", ""]);
    expect(instance.updateGamepadLabels).toHaveBeenCalledOnce();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await settled;
    expect(player.getState()).toBe("RUNNING");
  } finally {
    await player.exit();
    expect(runtimeWindow.EJS_controlScheme).toBeUndefined();
    frame.remove();
  }
});
