import {decodeStoredCheckpoint} from "../../provider/checkpoint-storage.js";
import {gunzipSync} from "fflate";
import {afterEach, describe, expect, it, vi} from "vitest";
import {projectProviderManifest} from "../../provider/manifest.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import type {RuntimeHostV1} from "../../provider/module-api.js";
afterEach(() => {document.body.replaceChildren();});

describe("NeoCD player lifecycle", () => {
  it("preserves bounded instant state across instances and provides standard controls", async () => {
    const snapshot = new Uint8Array(65536);
    snapshot.set([82, 65, 83, 84, 65, 84, 69, 1, 8, 7]); snapshot[snapshot.length - 1] = 19;
    const first = await mount(null, snapshot);
    expect(first.runtimeWindow.EJS_defaultControls).toMatchObject({0: {
      0: {value2: "BUTTON_1"}, 8: {value2: "BUTTON_2"},
      1: {value2: "BUTTON_3"}, 9: {value2: "BUTTON_4"},
      4: {value2: "DPAD_UP"}, 7: {value2: "DPAD_RIGHT"},
      3: {value: "1", value2: "START"},
    }});
    const controls = (first.runtimeWindow.EJS_defaultControls as Record<number, Record<number, {value2?: string}>>)[0]!;
    const bindings = Object.values(controls).flatMap((control) => control.value2 ? [control.value2] : []);
    expect(new Set(bindings).size).toBe(bindings.length);
    for (const button of [10, 11, 12, 13, 14, 15]) {expect(controls[button]?.value2).toBeUndefined();}
    expect(first.runtimeWindow.EJS_controlScheme).toBe("arcade");
    expect(first.runtimeWindow.EJS_dontExtractRom).toBe(true);
    expect((first.runtimeWindow.EJS_gameUrl as File).size).toBeLessThan(128);
    expect(first.runtimeWindow.RETROM_NEOCD_RANGE).toBeDefined();
    const saved = await first.player.checkpoint();
    expect(saved.format).toBe("emulatorjs-state-v1-storage-v1");
    expect(gunzipSync(saved.bytes)).toEqual(snapshot);
    expect(saved.bytes.length).toBeLessThan(snapshot.length / 10);
    expect(await decodeStoredCheckpoint(saved.bytes, saved.format, snapshot.length)).toEqual(snapshot);
    await first.player.exit();
    expect(first.runtimeWindow.EJS_gameUrl).toBeUndefined();
    expect(first.runtimeWindow.RETROM_NEOCD_RANGE).toBeUndefined();
    const restored = await mount(saved.bytes, new Uint8Array([4]), saved.format);
    expect(restored.load).toHaveBeenCalledWith(snapshot);
    expect(restored.toggle).toHaveBeenLastCalledWith(true);
    await restored.player.pause();
    expect(restored.toggle).toHaveBeenLastCalledWith(false);
    await restored.player.resume();
    expect(restored.toggle).toHaveBeenLastCalledWith(true);
    await restored.player.exit();
  });
  it("waits for a suspended disc read before pausing or serializing", async () => {
    const fixture = await mount(null, new Uint8Array([1, 2, 3]));
    const bridge = fixture.runtimeWindow.RETROM_NEOCD_RANGE as ReturnType<typeof import("./neocd-range.js").createNeoCDRange>;
    bridge.begin(); fixture.toggle.mockClear();
    const pause = fixture.player.pause();
    await Promise.resolve(); expect(fixture.toggle).not.toHaveBeenCalled();
    bridge.end(); await pause; expect(fixture.toggle).toHaveBeenCalledWith(false);
    bridge.begin(); let serialized = false;
    const saving = fixture.player.checkpoint().then(() => {serialized = true;});
    await Promise.resolve(); expect(serialized).toBe(false);
    bridge.end(); await saving; expect(serialized).toBe(true);
    await fixture.player.exit();
  });
  it("rejects an empty core checkpoint", async () => {
    const fixture = await mount(null, new Uint8Array());
    await expect(fixture.player.checkpoint()).rejects.toThrow();
    await fixture.player.exit();
  });
});
async function mount(restore: Uint8Array | null, state: Uint8Array, format = "emulatorjs-state-v1-storage-v1") {
  const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === "neocd")!;
  const manifest = projectProviderManifest(emulatorJsProviderDefinition).targets.find((entry) => entry.id === "neocd")!;
  const envelope = launchEnvelope();
  Object.assign(envelope.resources[0], {kind: "SEEKABLE_BLOB", rangeRequired: true});
  Object.assign(envelope.runtime, {targetId: "neocd", capabilities: manifest.capabilities, checkpoint: manifest.checkpoint});
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
  runtimeWindow.EJS_emulator = {startGame: vi.fn(), gameManager: {getState: () => state, loadExplicitStateAndWait: load, toggleMainLoop: toggle}};
  (runtimeWindow.EJS_ready as () => void)();
  (runtimeWindow.EJS_onGameStart as () => void)();
  await mounting;
  return {player, runtimeWindow, load, toggle};
}
