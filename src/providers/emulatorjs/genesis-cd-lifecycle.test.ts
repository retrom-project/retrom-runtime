import {afterEach, describe, expect, it, vi} from "vitest";
import {projectProviderManifest} from "../../provider/manifest.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import type {RuntimeHostV1} from "../../provider/module-api.js";

afterEach(() => {document.body.replaceChildren();});

describe("Sega CD player lifecycle", () => {
  it("mounts a small CHD marker through the EmulatorJS FS and closes pending reads", async () => {
    const target = emulatorJsProviderDefinition.targets.find(entry => entry.id === "genesis-plus-gx-cd")!;
    const manifest = projectProviderManifest(emulatorJsProviderDefinition).targets.find(entry => entry.id === target.id)!;
    const envelope = launchEnvelope();
    Object.assign(envelope.resources[0], {kind: "SEEKABLE_BLOB", rangeRequired: true, sizeBytes: 69545850});
    Object.assign(envelope.runtime, {targetId: target.id, capabilities: manifest.capabilities, checkpoint: manifest.checkpoint});
    const frame = document.createElement("iframe"); document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    runtimeWindow.fetch = vi.fn(async () => new Response("{}"));
    const host: RuntimeHostV1 = {signal: new AbortController().signal, reportDiagnostic: vi.fn(),
      mountFrame: async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin}), loadRestore: async () => null};
    const player = await createEmulatorJsPlayer(envelope, host, {
      [target.implementation.coreAssetPath]: {sha256: target.implementation.coreSha256, sizeBytes: target.implementation.coreSizeBytes},
    });
    const toggle = vi.fn();
    const callbacks = new Map<string, () => void>();
    const nodes = new Map<string, {usedBytes: number; stream_ops: {
      read?: (stream: unknown, buffer: Uint8Array, offset: number, length: number, position: number) => number;
    }}>();
    let wakeValue = -1;
    const fs = {writeFile: (path: string, bytes: Uint8Array) => {nodes.set(path, {usedBytes: bytes.length, stream_ops: {}});},
      lookupPath: (path: string) => ({node: nodes.get(path)!})};
    const module = {FS: fs, retromContentIOAsyncify: () => ({state: 0, State: {Normal: 0, Rewinding: 2},
      handleSleep: (start: (wake: (value: number) => void) => void) => {
      start(value => {wakeValue = value;}); return 0;
    }})};
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    runtimeWindow.EJS_emulator = {Module: module, on: (event: string, callback: () => void) => {callbacks.set(event, callback);},
      startGame: vi.fn(), gameManager: {getState: () => new Uint8Array([1]), toggleMainLoop: toggle}};
    (runtimeWindow.EJS_ready as () => void)();
    callbacks.get("saveDatabaseLoaded")!();
    expect(runtimeWindow.EJS_core).toBe("genesis_plus_gx");
    expect(runtimeWindow.EJS_dontExtractRom).toBe(true);
    expect((runtimeWindow.EJS_gameUrl as File).size).toBeLessThan(64);
    const marker = runtimeWindow.EJS_gameUrl as File;
    const filename = marker.name;
    fs.writeFile(filename, new Uint8Array(await marker.arrayBuffer()));
    const node = nodes.get(filename)!;
    expect(node.usedBytes).toBe(69545850);
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;
    node.stream_ops.read!({}, new Uint8Array(3), 0, 3, 0);
    const paused = player.pause();
    await Promise.resolve(); expect(toggle).not.toHaveBeenCalledWith(false);
    await vi.waitFor(() => expect(wakeValue).toBe(3));
    await paused; expect(toggle).toHaveBeenCalledWith(false);
    await player.exit();
    expect(node.usedBytes).toBe(marker.size);
  });
});

vi.mock("../../content-io/bootstrap.js", () => ({bootstrapContentSession: vi.fn(async () => ({
  open: vi.fn(async (source: {sizeBytes: number}) => ({abi: "content-io-v1", id: "fixture", sizeBytes: source.sizeBytes,
    tryReadInto: vi.fn(() => null), readInto: vi.fn(async (_offset: number, bytes: Uint8Array) => bytes.byteLength), close: vi.fn(async () => {})})),
  close: vi.fn(async () => {}), fail: vi.fn(),
}))}));
