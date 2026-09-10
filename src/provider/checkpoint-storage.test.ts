import {describe, expect, it} from "vitest";
import {gzipSync} from "fflate";
import {decodeStoredCheckpoint, encodeStoredCheckpoint} from "./checkpoint-storage.js";

const format = "emulatorjs-state-v1-storage-v1";
const maximum = 1024 * 1024;

describe("shared compressed checkpoints", () => {
  it("losslessly compresses the complete state including zero-filled sections", async () => {
    const state = new Uint8Array(maximum);
    state.set([82, 65, 83, 84, 65, 84, 69, 1]);
    state[maximum - 1] = 17;
    const compressed = await encodeStoredCheckpoint(state, format, maximum);
    expect(compressed.byteLength).toBeLessThan(state.byteLength / 20);
    expect(await decodeStoredCheckpoint(compressed, format, maximum)).toEqual(state);
    expect(state[maximum - 1]).toBe(17);
  });

  it("preserves legacy raw checkpoints without guessing their format from bytes", async () => {
    const bytes = Uint8Array.of(31, 139, 8, 0, 1);
    expect(await decodeStoredCheckpoint(bytes, "emulatorjs-state-v1", maximum)).toBe(bytes);
    await expect(encodeStoredCheckpoint(bytes, "emulatorjs-state-v1", maximum)).rejects.toThrow("PLAYER_RUNTIME_CONTRACT_INVALID");
  });

  it.each([format, "flycast-state-gzip-v1"])("rejects truncated and corrupt gzip states (%s)", async format => {
    const bytes = gzipSync(new Uint8Array(1000));
    await expect(decodeStoredCheckpoint(bytes.slice(0, -1), format, maximum)).rejects.toThrow();
    bytes[bytes.length - 8] ^= 1;
    await expect(decodeStoredCheckpoint(bytes, format, maximum)).rejects.toThrow();
  });

  it.each([format, "flycast-state-gzip-v1"])("enforces the decoded limit even when a gzip trailer lies about its size (%s)", async format => {
    const bytes = gzipSync(new Uint8Array(maximum + 1));
    await expect(decodeStoredCheckpoint(bytes, format, maximum)).rejects.toThrow();
    new DataView(bytes.buffer).setUint32(bytes.length - 4, 1, true);
    await expect(decodeStoredCheckpoint(bytes, format, maximum)).rejects.toThrow();
  });

  it("rejects empty, oversized, and unsupported checkpoints", async () => {
    for (const state of [new Uint8Array(), new Uint8Array(maximum + 1)]) {
      await expect(encodeStoredCheckpoint(state, format, maximum)).rejects.toThrow();
      await expect(decodeStoredCheckpoint(state, "emulatorjs-state-v1", maximum)).rejects.toThrow();
    }
    await expect(decodeStoredCheckpoint(gzipSync(new Uint8Array()), format, maximum)).rejects.toThrow();
  });
});

it.each([1, 32, 512 * 1024, 512 * 1024 + 1])("always writes one gzip layer for %i native bytes", async size => {
  const {gunzipSync} = await import("fflate");
  const raw = new Uint8Array(size); raw[size - 1] = 42;
  const encoded = await encodeStoredCheckpoint(raw, format, maximum);
  expect(Array.from(encoded.subarray(0, 3))).toEqual([31, 139, 8]);
  expect(Buffer.from(gunzipSync(encoded)).equals(Buffer.from(raw))).toBe(true);
  expect(Buffer.from(await decodeStoredCheckpoint(encoded, format, maximum)).equals(Buffer.from(raw))).toBe(true);
});

it.each(["emulatorjs-state-gzip-v1", "flycast-state-gzip-v1"])("reads historical %s through the common decoder", async format => {
  const raw = new Uint8Array(700000); raw[0] = 7;
  expect(await decodeStoredCheckpoint(gzipSync(raw), format, maximum)).toEqual(raw);
});

it("preserves cancellation and refuses a decompression bomb", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(encodeStoredCheckpoint(new Uint8Array([1]), format, maximum, controller.signal)).rejects.toMatchObject({name: "AbortError"});
  await expect(decodeStoredCheckpoint(gzipSync(new Uint8Array(maximum + 1)), format, maximum)).rejects.toThrow("PLAYER_RUNTIME_CONTRACT_INVALID");
});
