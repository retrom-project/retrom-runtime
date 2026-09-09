import {gunzipSync, zipSync, unzipSync} from "fflate";
import {decodeStoredCheckpoint, encodeStoredCheckpoint} from "../provider/checkpoint-storage.js";
import {describe, expect, it} from "vitest";
import {decodeCheckpoint, encodeCheckpoint} from "./state.js";
const identity = "a".repeat(64);
describe("PX68K checkpoint envelope", () => {
  it("restores state and the writable disk together", () => {
    const files = {"disk0.dim": new Uint8Array([1, 2, 3])};
    const bytes = encodeCheckpoint(identity, new Uint8Array([4, 5]), files, 120);
    const restored = decodeCheckpoint(identity, bytes);
    expect(restored.state).toEqual(new Uint8Array([4, 5]));
    expect(restored.files).toEqual(files);
    expect(restored.frames).toBe(120);
  });
  it("rejects another game, corrupt data, empty state and escaped disk paths", () => {
    const bytes = encodeCheckpoint(identity, new Uint8Array([7]), {}, 0);
    expect(() => decodeCheckpoint("b".repeat(64), bytes)).toThrow();
    expect(() => decodeCheckpoint(identity, bytes.slice(0, -1))).toThrow();
    expect(() => encodeCheckpoint(identity, new Uint8Array(), {}, 0)).toThrow();
    expect(() => encodeCheckpoint(identity, new Uint8Array([1]), {"../bios": new Uint8Array([1])}, 0)).toThrow();
  });
});

it("stores uncompressed ZIP entries and delegates compression to the shared layer", async () => {
  const state = new Uint8Array(10000); state[9999] = 23;
  const envelope = encodeCheckpoint(identity, state, {}, 42);
  expect(new DataView(envelope.buffer, envelope.byteOffset).getUint16(8, true)).toBe(0);
  const stored = await encodeStoredCheckpoint(envelope, "px68k-state-v1-storage-v1", 100000);
  expect(gunzipSync(stored)).toEqual(envelope);
  expect(stored.length).toBeLessThan(envelope.length / 2);
  const raw = await decodeStoredCheckpoint(stored, "px68k-state-v1-storage-v1", 100000);
  expect(decodeCheckpoint(identity, raw)).toMatchObject({state, frames: 42});
  const legacy = zipSync(unzipSync(envelope), {level: 6});
  expect(decodeCheckpoint(identity, legacy)).toMatchObject({state, frames: 42});
});
