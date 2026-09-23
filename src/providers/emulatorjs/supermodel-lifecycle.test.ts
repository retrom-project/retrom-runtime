import {expect, it, vi} from "vitest";

import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";

it("keeps the Model 3 ZIP intact and reads its native state through the 4.3 frontend", async () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
  runtimeWindow.Response = Response;
  runtimeWindow.fetch = fetch;
  const envelope = launchEnvelope();
  envelope.runtime.targetId = "supermodel";
  envelope.session.purpose = "REVIEW_PREVIEW";
  const player = await createEmulatorJsPlayer(envelope, {
    loadRestore: vi.fn(async () => null),
    mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
    reportDiagnostic: vi.fn(), signal: new AbortController().signal,
  }, {
    "assets/4.3.0-pre/data/cores/supermodel-wasm.data": {
      sha256: "0fec2c536500685b0a9456f7c3ad3d01c3214696cbf7ef3c218b42dc7e3b2355", sizeBytes: 1365895,
    },
  });
  try {
    const mounting = player.mount(document.createElement("div"));
    const mounted = mounting.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    const manager = {Module: {HEAPU8: Uint8Array.of(0, 1, 2, 3),
      cwrap: () => () => "2|1|1"}, getState: () => {throw new Error("EmulatorJSGetState missing");}};
    const instance: {downloadType: {rom: {dontExtractIfCore: string[]}}; gameManager?: typeof manager} = {
      downloadType: {rom: {dontExtractIfCore: []}},
    };
    runtimeWindow.EJS_emulator = instance;
    const start = runtimeWindow.document.createElement("button");
    start.className = "ejs_start_button";
    start.onclick = () => {instance.gameManager = manager; (runtimeWindow.EJS_onGameStart as () => void)();};
    runtimeWindow.document.body.append(start);
    (runtimeWindow.EJS_ready as () => void)();
    expect(await mounted).toBeNull();
    expect(instance.downloadType.rom.dontExtractIfCore).toContain("supermodel");
    expect(runtimeWindow.EJS_startOnLoaded).toBe(false);
    expect(instance.gameManager?.getState()).toEqual(Uint8Array.of(1, 2));
    expect(player.getState()).toBe("RUNNING");
  } finally {
    await player.exit();
    frame.remove();
  }
});
