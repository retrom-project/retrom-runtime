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
  ["genesis-plus-gx", "segaGG", "game.GG"],
  ["genesis-plus-gx", "segaMS", "game.sg"],
  ["cap32", undefined, "game.cpr"],
] as const)("selects the explicit controller layout before %s builds its input map", async (targetId, scheme, filename) => {
  const target = emulatorJsProviderDefinition.targets.find((candidate) => candidate.id === targetId)!;
  const implementation = target.implementation;
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
  runtimeWindow.Response = Response;
  runtimeWindow.fetch = fetch;
  const envelope = launchEnvelope();
  envelope.runtime.targetId = targetId;
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
    expect(runtimeWindow.EJS_defaultControls).toMatchObject({
      0: {1: {value: "l", value2: "BUTTON_4"}, 3: {value: "1", value2: "START"}},
    });
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
