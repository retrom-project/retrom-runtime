import {expect, it, vi} from "vitest";

import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
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
  const player = await createEmulatorJsPlayer(envelope, {
    loadRestore: vi.fn(async () => null),
    mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
    reportDiagnostic: vi.fn(), signal: new AbortController().signal,
  }, {
    "assets/4.3.0-pre/data/cores/dosbox_pure-thread-wasm.data": {
      sha256: "89b0e89b03ced9ba07c5fe27bc789fd0f42bd5378b399f93befa2edc3571a70a", sizeBytes: 1827779,
    },
  });
  try {
    const mounting = player.mount(document.createElement("div"));
    const mounted = mounting.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    const instance: {downloadType: {rom: {dontExtractIfCore: string[]}}; gameManager?: object} = {
      downloadType: {rom: {dontExtractIfCore: []}},
    };
    runtimeWindow.EJS_emulator = instance;
    const start = runtimeWindow.document.createElement("button");
    start.className = "ejs_start_button";
    start.onclick = () => {
      instance.gameManager = {getState: () => Uint8Array.of(1)};
      (runtimeWindow.EJS_onGameStart as () => void)();
    };
    runtimeWindow.document.body.append(start);
    (runtimeWindow.EJS_ready as () => void)();
    expect(await mounted).toBeNull();
    expect(instance.downloadType.rom.dontExtractIfCore).toContain("dosbox_pure");
    expect(player.getState()).toBe("RUNNING");
  } finally {
    await player.exit();
    frame.remove();
  }
});
