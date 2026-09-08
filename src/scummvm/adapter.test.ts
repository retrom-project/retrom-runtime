// @vitest-environment jsdom
import {webcrypto} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mountScummvm} from "./adapter.js";
import {decodeScummvmSave, encodeScummvmSave, saveDigest} from "./checkpoint.js";
import {selectionConfig, type ScummvmParameters} from "./parameters.js";
import type {ScummvmBridge} from "./bridge.js";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["image"], {type: "image/png"})));
});
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});
const config: ScummvmParameters = {contentDigest: "a".repeat(64), projectIndexUrl: "http://localhost/game/index.json",
  runtimeBaseUrl: "http://localhost/core/", selection: {engineId: "sky", gameId: "sky", root: "", language: "en",
    platform: "pc", extra: "v0.0348 Floppy", guiOptions: "sndNoSpeech", filename: null}};

async function fixture(earlyExit = false, reportRestore = true) {
  const data = new Uint8Array([1, 2, 3]);
  const hash = await saveDigest(data);
  const assets = ["scummvm.wasm", "plugins/libsky.so", "plugins/libqueen.so", "data/encoding.dat"]
    .map((path) => ({path, sizeBytes: data.length, sha256: hash}));
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("manifest.json")) {return Response.json({schemaVersion: 1, adapterAbi: "scummvm-host-v1",
      upstreamCommit: "b".repeat(40), engines: {sky: "plugins/libsky.so", queen: "plugins/libqueen.so"}, files: assets});}
    if (url.endsWith("index.json")) {return Response.json({schemaVersion: 1,
      files: [{path: "sky.dsk", sizeBytes: 3000000, url: "http://localhost/game/sky.dsk"}]});}
    return new Response(data);
  });
  vi.stubGlobal("fetch", fetcher);
  const files = new Map<string, Uint8Array>();
  const fs = {mkdirTree: vi.fn(), writeFile: (path: string, bytes: Uint8Array | string) => files.set(path,
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes),
    readFile: (path: string) => files.get(path)!, isDir: () => false,
    readdir: (path: string) => [".", "..", ...[...files.keys()].filter((name) => name.startsWith(`${path}/`)).map((name) => name.slice(path.length + 1))],
    stat: (path: string) => ({mode: 0, size: files.get(path)!.byteLength})};
  let options: {retromHost: ScummvmBridge & {onEngineStopping(): void; onEngineStopped(code: number): void; onRestoreResult?(slot: number, success: boolean): void}};
  const factory = vi.fn(async (value: Record<string, unknown>) => {
    options = value as typeof options;
    return {FS: fs, callMain: () => {if (earlyExit) {options.retromHost.onEngineStopped(0); return;} options.retromHost.onStatus({capture: true, available: true, automatic: true});
      const slot = /save_slot=(\d+)/u.exec(new TextDecoder().decode(files.get("/scummvm.ini")));
      if (reportRestore && slot) {options.retromHost.onRestoreResult?.(Number(slot[1]), true);}}};
  });
  const onExit = vi.fn(); const onFailure = vi.fn();
  const target = document.createElement("div");
  const loader = vi.fn(async () => ({adapterAbi: "scummvm-host-v1", createScummVM: factory}));
  return {files, factory, fetcher, onExit, onFailure, host: () => options.retromHost,
    mount: (restore: Uint8Array | null = null) => mountScummvm(config, target, window, restore, vi.fn(), onExit, onFailure, undefined, loader)};
}

async function restoreFixture() {
  const identity = await saveDigest(new TextEncoder().encode(`${config.contentDigest}\n${selectionConfig(config.selection, null)}`));
  return encodeScummvmSave({identity, resumeSlot: 7, files: [{path: "target.007", data: new Uint8Array([8])}]});
}

describe("ScummVM browser adapter", () => {
  it("keeps automatic restore mounting until the exact slot is confirmed by the engine", async () => {
    const f = await fixture(false, false);
    let mounted = false;
    const pending = f.mount(await restoreFixture()).then((value) => {mounted = true; return value;});
    await vi.waitFor(() => expect(f.factory).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mounted).toBe(false);
    f.host().onRestoreResult?.(7, true);
    const adapter = await pending;
    f.host().onEngineStopped(0); await adapter.exit();
  });

  it.each([[7, false], [8, true]] as const)("rejects rejected or mismatched native restoration (%i, %s)", async (slot, success) => {
    const f = await fixture(false, false);
    const pending = f.mount(await restoreFixture());
    const rejected = expect(pending).rejects.toThrow("SCUMMVM_RESTORE_FAILED");
    await vi.waitFor(() => expect(f.factory).toHaveBeenCalledOnce());
    f.host().onRestoreResult?.(slot, success);
    await rejected;
  });

  it("rejects initialization immediately when the native engine exits before its first status", async () => {
    const f = await fixture(true);
    await expect(f.mount()).rejects.toThrow("SCUMMVM_RUNTIME_STOPPED");
    await vi.waitFor(() => expect(f.onExit).toHaveBeenCalledOnce());
  });

  it("loads only the selected engine and indexes game files without fetching them", async () => {
    const f = await fixture(); const adapter = await f.mount();
    expect((f.factory.mock.calls[0][0].canvas as HTMLCanvasElement).id).toBe("canvas");
    expect(f.fetcher.mock.calls.map(([url]) => url)).toContain("http://localhost/core/plugins/libsky.so");
    expect(f.fetcher.mock.calls.map(([url]) => url)).not.toContain("http://localhost/core/plugins/libqueen.so");
    expect(f.fetcher.mock.calls.map(([url]) => url)).not.toContain("http://localhost/game/sky.dsk");
    expect(new TextDecoder().decode(f.files.get("/scummvm.ini"))).toContain("extra=v0.0348 Floppy");
    expect(f.files.has("/saves/target.001")).toBe(false);
    f.host().onEngineStopped(0);
    await adapter.exit();
  });

  it("restores files and the exact native slot before main starts, with no hidden session persistence", async () => {
    const f = await fixture(); const first = await f.mount();
    const host = f.host(); const saved = first.checkpoint();
    host.onWrite(true); f.files.set("/saves/target.007", new Uint8Array([8])); host.onWrite(false);
    host.onSaveResult(7, 0); host.onBoundary();
    const checkpoint = await saved;
    host.onEngineStopped(0); await first.exit();
    const next = await fixture(); const restored = await next.mount(checkpoint.bytes);
    expect(next.files.get("/saves/target.007")).toEqual(new Uint8Array([8]));
    expect(new TextDecoder().decode(next.files.get("/scummvm.ini"))).toContain("save_slot=7");
    expect(restored.getCheckpointAvailability()).toMatchObject({available: false, blocker: "UNCHANGED"});
    next.host().onEngineStopped(0); await restored.exit();
  });

  it("closes checkpoint on native exit and hands off the last write once", async () => {
    const f = await fixture(); const adapter = await f.mount(); const host = f.host();
    host.onWrite(true); f.files.set("/saves/target.001", new Uint8Array([8])); host.onWrite(false);
    host.onEngineStopping();
    expect(adapter.getCheckpointAvailability().available).toBe(false);
    expect(f.onExit).not.toHaveBeenCalled();
    host.onWrite(true); f.files.set("/saves/target.001", new Uint8Array([9])); host.onWrite(false);
    host.onEngineStopped(0); host.onEngineStopped(0);
    await vi.waitFor(() => expect(f.onExit).toHaveBeenCalledOnce());
    const checkpoint = f.onExit.mock.calls[0][0].checkpoint;
    // A native destructor overwrote the live save before final handoff.
    expect(checkpoint.bytes.at(-1)).toBe(9);
    await adapter.exit();
  });

  it("rejects a foreign save before loading executable core code", async () => {
    const f = await fixture();
    const bytes = await encodeScummvmSave({identity: "b".repeat(64), resumeSlot: null,
      files: [{path: "target.001", data: new Uint8Array([1])}]});
    await expect(f.mount(bytes)).rejects.toThrow("SCUMMVM_SAVE_INVALID");
    expect(f.factory).not.toHaveBeenCalled();
    await expect(decodeScummvmSave(bytes, "a".repeat(64))).rejects.toThrow("SCUMMVM_SAVE_INVALID");
  });

  it("fails closed for a core-script exception after mounting without consuming unrelated window errors", async () => {
    const f = await fixture(); const adapter = await f.mount();
    window.dispatchEvent(new ErrorEvent("error", {message: "unrelated", filename: "http://localhost/tools/vitals.js"}));
    expect(f.onFailure).not.toHaveBeenCalled();
    window.dispatchEvent(new ErrorEvent("error", {message: "native callback failed", filename: `${config.runtimeBaseUrl}scummvm.mjs`}));
    expect(f.onFailure).toHaveBeenCalledWith(new Error("SCUMMVM_RUNTIME_FAILED"));
    expect(adapter.getCheckpointAvailability()).toMatchObject({available: false, blocker: "NOT_READY"});
    f.host().onEngineStopped(1); await adapter.exit();
  });
});
