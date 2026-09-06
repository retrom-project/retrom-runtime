import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {gzipSync} from "fflate";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import {projectProviderManifest} from "../../provider/manifest.js";
import type {RuntimeHostV1} from "../../provider/module-api.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createEmulatorJsPlayer} from "./provider-runtime.js";
import {decodeEmulatorJsCheckpoint} from "./checkpoint-codec.js";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {observe() {} disconnect() {}});
});
afterEach(() => {vi.unstubAllGlobals(); document.body.replaceChildren();});

describe("PSP checkpoint product boundary", () => {
  it.each(["emulatorjs-state-v1", "emulatorjs-state-gzip-v1"])("restores %s and creates a compressed checkpoint", async (format) => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const runtimeWindow = frame.contentWindow as Window & Record<string, unknown>;
    runtimeWindow.fetch = vi.fn(async () => new Response("ok"));
    const original = new Uint8Array(64 * 1024);
    original.set([82, 65, 83, 84, 65, 84, 69, 1]); original[original.length - 1] = 19;
    const stored = format === "emulatorjs-state-v1" ? original : gzipSync(original);
    const envelope = launchEnvelope();
    const target = projectProviderManifest(emulatorJsProviderDefinition).targets.find((entry) => entry.id === "ppsspp")!;
    const implementation = emulatorJsProviderDefinition.targets.find((entry) => entry.id === "ppsspp")!.implementation;
    envelope.runtime.targetId = target.id;
    envelope.runtime.capabilities = target.capabilities;
    envelope.runtime.checkpoint = target.checkpoint;
    envelope.restore = {format, sha256: "a".repeat(64), sizeBytes: stored.length, url: "/runtime/restore"};
    const host: RuntimeHostV1 = {
      loadRestore: vi.fn(async () => stored),
      mountFrame: vi.fn(async () => ({contentWindow: runtimeWindow, element: frame, origin: location.origin})),
      reportDiagnostic: vi.fn(), signal: new AbortController().signal,
    };
    const player = await createEmulatorJsPlayer(envelope, host, {
      [implementation.coreAssetPath]: {sha256: implementation.coreSha256, sizeBytes: implementation.coreSizeBytes},
    });
    let native!: {print: (message: string) => void; postMainLoop: () => void};
    const loadState = vi.fn(async () => {native.print('[State] Loading state "/game.state".'); native.postMainLoop(); native.postMainLoop(); return 0;});
    const writeFile = vi.fn();
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(runtimeWindow.document.querySelector("script[data-retrom-loader]")).not.toBeNull());
    runtimeWindow.EJS_Runtime = (config: typeof native) => {native = config;};
    (runtimeWindow.EJS_Runtime as (config: object) => unknown)({});
    const heap = new Uint8Array(original.length + 64); heap.set(original, 64);
    runtimeWindow.EJS_emulator = {gameManager: {
      Module: {HEAPU8: heap, cwrap: (name: string) => name === "load_state" ? loadState : async () => 16, UTF8ToString: () => `${original.length}|64|1`, _free: vi.fn()},
      FS: {writeFile, unlink: vi.fn()}, getState: () => original, toggleMainLoop: vi.fn(), simulateInput: vi.fn(),
    }};
    (runtimeWindow.EJS_ready as () => void)();
    (runtimeWindow.EJS_onGameStart as () => void)();
    await mounting;
    expect(writeFile).toHaveBeenCalledWith("/game.state", original);
    expect(loadState).toHaveBeenCalledWith("/game.state", 0);
    const checkpoint = await player.checkpoint();
    expect(checkpoint.format).toBe("emulatorjs-state-gzip-v1");
    expect(checkpoint.bytes.length).toBeLessThan(original.length / 20);
    expect(await decodeEmulatorJsCheckpoint(checkpoint.bytes, checkpoint.format, original.length)).toEqual(original);
    await player.exit();
  });
});
