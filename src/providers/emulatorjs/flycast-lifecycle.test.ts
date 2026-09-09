import {decodeEmulatorJsCheckpoint} from "./checkpoint-codec.js";
import {afterEach, describe, expect, it, vi} from "vitest";
import {projectProviderManifest} from "../../provider/manifest.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import type {RuntimeHostV1} from "../../provider/module-api.js";
vi.mock("./flycast-cache.js", () => ({loadFlycastDisc: async () => new Blob(["disc"])}));
afterEach(() => {document.body.replaceChildren();});

describe("Flycast player lifecycle", () => {
  it("preserves bounded instant state across instances and provides standard controls", async () => {
    const snapshot = new Uint8Array(65536);
    snapshot.set([82, 65, 83, 84, 65, 84, 69, 1, 8, 7]); snapshot[snapshot.length - 1] = 19;
    const first = await mount(null, snapshot);
    expect(first.runtimeWindow.EJS_defaultControls).toMatchObject({0: {
      0: {value2: "BUTTON_1"}, 8: {value2: "BUTTON_2"},
      1: {value2: "BUTTON_3"}, 9: {value2: "BUTTON_4"},
      3: {value: "1", value2: "START"},
    }});
    expect(first.runtimeWindow.EJS_dontExtractRom).toBe(true);
    const saved = await first.player.checkpoint();
    expect(saved.format).toBe("flycast-state-gzip-v1");
    expect(saved.bytes.length).toBeLessThan(snapshot.length / 10);
    expect(await decodeEmulatorJsCheckpoint(saved.bytes, saved.format, snapshot.length)).toEqual(snapshot);
    await first.player.exit();
    expect(first.runtimeWindow.EJS_gameUrl).toBeUndefined();
    const restored = await mount(saved.bytes, new Uint8Array([4]), saved.format);
    expect(restored.load).toHaveBeenCalledWith(snapshot);
    expect(restored.toggle).toHaveBeenLastCalledWith(true);
    await restored.player.pause();
    expect(restored.toggle).toHaveBeenLastCalledWith(false);
    await restored.player.resume();
    expect(restored.toggle).toHaveBeenLastCalledWith(true);
    await restored.player.exit();
  });
  it("continues to load the existing raw Flycast saves", async () => {
    const raw = new Uint8Array([82, 65, 83, 84, 65, 84, 69, 1, 5]);
    const restored = await mount(raw, raw);
    expect(restored.load).toHaveBeenCalledWith(raw);
    await restored.player.exit();
  });
  it("rejects an empty core checkpoint", async () => {
    const fixture = await mount(null, new Uint8Array());
    await expect(fixture.player.checkpoint()).rejects.toThrow();
    await fixture.player.exit();
  });
});
async function mount(restore: Uint8Array | null, state: Uint8Array, format = "flycast-state-v1") {
  const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === "flycast")!;
  const manifest = projectProviderManifest(emulatorJsProviderDefinition).targets.find((entry) => entry.id === "flycast")!;
  const envelope = launchEnvelope();
  Object.assign(envelope.runtime, {targetId: "flycast", capabilities: manifest.capabilities, checkpoint: manifest.checkpoint});
  if (restore) {envelope.restore = {format, sha256: "a".repeat(64), sizeBytes: restore.length, url: "/restore"};}
  const frame = document.createElement("iframe"); document.body.append(frame);
  const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
  runtimeWindow.fetch = vi.fn(async () => new Response("{}"));
  const host: RuntimeHostV1 = {signal: new AbortController().signal, reportDiagnostic: vi.fn(),
    mountFrame: async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin}), loadRestore: async () => restore};
  const implementation = target.implementation;
  const player = await createEmulatorJsPlayer(envelope, host, {
    [implementation.coreAssetPath]: {sha256: implementation.coreSha256, sizeBytes: implementation.coreSizeBytes},
  });
  const load = vi.fn(async () => {}), toggle = vi.fn();
  const mounting = player.mount(document.createElement("div"));
  await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
  runtimeWindow.EJS_emulator = {gameManager: {getState: () => state, loadExplicitStateAndWait: load, toggleMainLoop: toggle}};
  (runtimeWindow.EJS_ready as () => void)();
  (runtimeWindow.EJS_onGameStart as () => void)();
  await mounting;
  return {player, runtimeWindow, load, toggle};
}
