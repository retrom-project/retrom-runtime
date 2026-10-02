import {afterEach, expect, it, vi} from "vitest";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {deferred} from "../../../tests/provider-adapter-fixture.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import type {RuntimeHostV1} from "../../provider/module-api.js";

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren();});

it.each([
  {target: "fceumm", release: "4.2.3", asset: "fceumm-wasm.data", digest: "8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493", size: 1054015},
  {target: "beetle-vb", release: "4.2.3", asset: "beetle_vb-wasm.data", digest: "3db727a78b6a6551a4024c273069eb39c8e8f33aa78ef16a073ed7460f6ce692", size: 858313},
])("keeps $target startup alive for a progressing download beyond 30 seconds", async ({target, release, asset, digest, size}) => {
  vi.useFakeTimers();
  const frame = document.createElement("iframe"); document.body.append(frame);
  const runtimeWindow = frame.contentWindow as Window & typeof globalThis & Record<string, unknown>;
  runtimeWindow.fetch = vi.fn(async () => new Response("ok"));
  vi.spyOn(runtimeWindow.XMLHttpRequest.prototype, "send").mockImplementation(() => {});
  const host: RuntimeHostV1 = {
    loadRestore: vi.fn(async () => null), mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
    reportDiagnostic: vi.fn(), signal: new AbortController().signal,
  };
  const envelope = launchEnvelope(); envelope.runtime.targetId = target;
  const player = await createEmulatorJsPlayer(envelope, host, {[`assets/${release}/data/cores/${asset}`]: {sha256: digest, sizeBytes: size}});
  const mounting = player.mount(document.createElement("div"));
  const result = mounting.catch(error => error);
  await vi.advanceTimersByTimeAsync(0);
  const downloaded = deferred<void>();
  const xhr = new runtimeWindow.XMLHttpRequest();
  runtimeWindow.EJS_emulator = {gameManager: {getState: () => new Uint8Array([1]), simulateInput: vi.fn()},
    downloadFile: async (url: string) => {xhr.open("GET", url); xhr.send(); await downloaded.promise; return new Uint8Array([1]);},
  };
  (runtimeWindow.EJS_ready as () => void)();
  const transfer = (runtimeWindow.EJS_emulator as {downloadFile(url: string): Promise<unknown>}).downloadFile("https://game.test/core.data");
  for (let loaded = 1; loaded <= 4; loaded++) {
    await vi.advanceTimersByTimeAsync(20_000);
    xhr.dispatchEvent(new runtimeWindow.ProgressEvent("progress", {loaded, total: 5, lengthComputable: true}));
    expect(player.getState()).toBe("MOUNTING");
  }
  xhr.dispatchEvent(new runtimeWindow.Event("loadend")); downloaded.resolve(); await transfer;
  (runtimeWindow.EJS_onGameStart as () => void)(); await result;
  expect(player.getState()).toBe("RUNNING"); await player.exit();
});
