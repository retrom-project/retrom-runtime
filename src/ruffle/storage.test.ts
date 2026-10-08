import {describe, expect, it} from "vitest";
import {RuffleStorage, ruffleSaveFormat, maximumRuffleSaveBytes} from "./storage.js";
import {runInNewContext} from "node:vm";

const identity = "a".repeat(64);
const name = "retrom.invalid/game.swf/progress";

describe("Ruffle native saves", () => {
  it("freezes changes on stop while accepting validated identical destructor flushes", async () => {
    const store = new RuffleStorage(identity);
    const bytes = new Uint8Array([1, 2, 3]);
    store.put(name, bytes);
    store.put("empty", new Uint8Array());
    const captured = await store.checkpoint();
    store.put(name, new Uint8Array([4]));
    const revision = store.availability();
    const latest = await store.checkpoint();
    store.stop();
    store.stop();
    expect(store.put(name, runInNewContext("new Uint8Array([4])") as Uint8Array)).toBe(true);
    expect(store.put(name, new Uint8Array([4]))).toBe(true);
    expect(store.put(name, bytes)).toBe(false);
    expect(store.put("new", new Uint8Array([4]))).toBe(false);
    expect(store.put("../escape", new Uint8Array([4]))).toBe(false);
    expect(store.put(name, new Uint8Array(maximumRuffleSaveBytes))).toBe(false);
    expect(store.put("empty", new DataView(new ArrayBuffer(0)) as unknown as Uint8Array)).toBe(false);
    store.remove(name);
    expect(store.get(name)).toEqual(new Uint8Array([4]));
    expect(store.availability()).toEqual(revision);
    expect(await store.checkpoint()).toEqual(latest);
    // A pending upload may acknowledge its own earlier bytes, never newer data.
    await store.acknowledge(captured);
    expect(store.availability().available).toBe(true);
    expect(await store.checkpoint()).toEqual(latest);
  });
  it("preserves root-path SharedObject keys emitted by Flash", () => {
    const store = new RuffleStorage(identity);
    expect(store.put("retrom.invalid//progress", new Uint8Array([1]))).toBe(true);
  });
  it("restores native data in a new instance without leaking it to a fresh launch", async () => {
    const first = new RuffleStorage(identity);
    expect(first.availability()).toMatchObject({available: false, blocker: "NO_SAVE", save: {dataKind: "STORAGE"}});
    const data = new Uint8Array([1, 2, 3]);
    expect(first.put(name, data)).toBe(true);
    data[0] = 99;
    const save = await first.checkpoint();
    expect(save.format).toBe(ruffleSaveFormat);
    const restored = new RuffleStorage(identity, save.bytes);
    expect(restored.get(name)).toEqual(new Uint8Array([1, 2, 3]));
    expect(restored.availability()).toMatchObject({available: false, blocker: "UNCHANGED"});
    expect(new RuffleStorage(identity).get(name)).toBeNull();
    expect(() => new RuffleStorage("b".repeat(64), save.bytes)).toThrow("RUFFLE_SAVE_INVALID");
  });

  it("does not acknowledge newer writes when an earlier export finishes uploading", async () => {
    const store = new RuffleStorage(identity);
    store.put(name, new Uint8Array([1]));
    const revision = store.availability();
    store.put(name, new Uint8Array([1]));
    expect(store.availability()).toEqual(revision);
    const first = await store.checkpoint();
    store.put(name, new Uint8Array([2]));
    await store.acknowledge(first);
    expect(store.availability().available).toBe(true);
    store.put(name, new Uint8Array([1]));
    expect(store.availability()).toMatchObject({blocker: "UNCHANGED"});
  });

  it("transports deletion of the last save and rejects corrupt, oversized or unsafe data", async () => {
    const first = new RuffleStorage(identity);
    first.put(name, new Uint8Array([1]));
    const restored = new RuffleStorage(identity, (await first.checkpoint()).bytes);
    restored.remove(name);
    const deleted = await restored.checkpoint();
    expect(deleted.bytes.length).toBeGreaterThan(0);
    expect(new RuffleStorage(identity, deleted.bytes).get(name)).toBeNull();
    expect(first.put("../escape", new Uint8Array([1]))).toBe(false);
    expect(first.put(name, new Uint8Array(maximumRuffleSaveBytes))).toBe(false);
    expect(() => new RuffleStorage(identity, new Uint8Array([1, 2]))).toThrow("RUFFLE_SAVE_INVALID");
    expect(() => new RuffleStorage(identity, new Uint8Array(maximumRuffleSaveBytes + 1))).toThrow("RUFFLE_SAVE_INVALID");
  });
});
