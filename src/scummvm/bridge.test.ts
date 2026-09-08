import {webcrypto} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ScummvmBridge} from "./bridge.js";
import {decodeScummvmSave} from "./checkpoint.js";

const identity = "a".repeat(64);
beforeEach(() => {vi.stubGlobal("crypto", webcrypto);});
afterEach(() => {vi.unstubAllGlobals();});
function fixture() {
  const files = new Map<string, Uint8Array>();
  const fs = {readdir: () => [".", "..", ...files.keys()],
    readFile: (path: string) => files.get(path.slice(7))!,
    stat: (path: string) => ({size: files.get(path.slice(7))!.byteLength, mode: 0}), isDir: () => false};
  const bridge = new ScummvmBridge(identity);
  bridge.attach(fs);
  bridge.onStatus({capture: true, available: true, automatic: true});
  const write = (value = 1) => {bridge.onWrite(true); files.set("target.001", new Uint8Array([value, 2])); bridge.onWrite(false);};
  return {bridge, files, write};
}

describe("ScummVM safe native save boundary", () => {
  it("waits for the completed native slot and a closed-write boundary, even when paused", async () => {
    const {bridge, write} = fixture();
    bridge.paused = true;
    const pending = bridge.checkpoint();
    expect(bridge.command).toBe(1);
    write();
    bridge.onBoundary();
    let finished = false; void pending.then(() => {finished = true;});
    await Promise.resolve(); expect(finished).toBe(false);
    bridge.onSaveResult(7, 0); bridge.onBoundary();
    const checkpoint = await pending;
    expect((await decodeScummvmSave(checkpoint.bytes, identity)).resumeSlot).toBe(7);
    expect(bridge.paused).toBe(true);
    expect(bridge.getAvailability().available).toBe(true);
    await bridge.acknowledge(checkpoint);
    expect(bridge.getAvailability()).toMatchObject({available: false, blocker: "UNCHANGED"});
  });

  it("exports in-game saves without requesting another save or guessing a restore slot", async () => {
    const {bridge, write} = fixture(); write();
    const pending = bridge.checkpoint({intent: "EXPORT"});
    expect(bridge.command).toBe(0);
    bridge.onBoundary();
    expect((await decodeScummvmSave((await pending).bytes, identity)).resumeSlot).toBeNull();
    expect(bridge.getAvailability().save?.restore).toBe("IN_GAME");
  });

  it("does not acknowledge writes that happened after the exported snapshot", async () => {
    const {bridge, write} = fixture(); write();
    const pending = bridge.checkpoint({intent: "EXPORT"}); bridge.onBoundary();
    const checkpoint = await pending; const original = bridge.getAvailability(); write(3);
    await bridge.onBoundary(); await bridge.acknowledge(checkpoint);
    expect(bridge.getAvailability().available).toBe(true);
    expect(bridge.getAvailability()).not.toEqual(original);
  });

  it("keeps the content revision and exact restore slot for identical native rewrites", async () => {
    const {bridge, write} = fixture(); const pending = bridge.checkpoint(); write();
    bridge.onSaveResult(7, 0); bridge.onBoundary(); const first = await pending;
    const original = bridge.getAvailability(); write(); await bridge.onBoundary();
    expect(bridge.getAvailability()).toEqual(original);
    const next = bridge.checkpoint({intent: "EXPORT"}); bridge.onBoundary();
    expect((await next).bytes).toEqual(first.bytes);
    await bridge.acknowledge(first); write(); await bridge.onBoundary();
    expect(bridge.getAvailability()).toMatchObject({blocker: "UNCHANGED"});
    expect(await bridge.stop()).toBeNull();
  });

  it("publishes only closed native files and handles deleting the last save", async () => {
    const {bridge, write, files} = fixture(); write(); await bridge.onBoundary();
    expect(bridge.getAvailability().available).toBe(true);
    bridge.onWrite(true); files.set("partial", new Uint8Array([4]));
    await bridge.onBoundary(); expect(bridge.getAvailability()).toMatchObject({blocker: "BUSY"});
    files.clear(); bridge.onWrite(false); await bridge.onBoundary();
    expect(bridge.getAvailability()).toMatchObject({blocker: "NO_SAVE"});
    expect(await bridge.stop()).toBeNull();
  });

  it("closes live saves before teardown but includes destructor writes in the final snapshot", async () => {
    const {bridge, write} = fixture(); write(); const pending = bridge.checkpoint({intent: "EXPORT"});
    bridge.onBoundary(); await bridge.acknowledge(await pending);
    bridge.beginStop(); expect(bridge.getAvailability()).toMatchObject({blocker: "NOT_READY"});
    write(9); const final = await bridge.stop();
    expect((await decodeScummvmSave(final!.bytes, identity)).files[0].data[0]).toBe(9);
  });

  it("rejects disallowed captures, native errors and concurrent requests without false success", async () => {
    const {bridge} = fixture();
    bridge.onStatus({capture: true, available: false, automatic: false});
    await expect(bridge.checkpoint()).rejects.toThrow("SCUMMVM_SAVE_DISABLED");
    bridge.onStatus({capture: true, available: true, automatic: false});
    const pending = bridge.checkpoint();
    await expect(bridge.checkpoint()).rejects.toThrow("SCUMMVM_SAVE_BUSY");
    bridge.onSaveResult(-1, 7);
    await expect(pending).rejects.toThrow("SCUMMVM_SAVE_FAILED");
  });

  it("freezes the final native files and immediately closes live checkpoint capability on engine exit", async () => {
    const {bridge, write, files} = fixture(); write();
    const final = bridge.stop();
    files.get("target.001")![0] = 9;
    expect(bridge.getAvailability()).toMatchObject({available: false, blocker: "NOT_READY"});
    await expect(bridge.checkpoint()).rejects.toThrow("SCUMMVM_RUNTIME_STOPPED");
    expect((await decodeScummvmSave((await final)!.bytes, identity)).files[0].data[0]).toBe(1);
    expect(await bridge.stop()).toBeNull();
  });
});
