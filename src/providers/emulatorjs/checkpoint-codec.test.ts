import {describe, expect, it} from "vitest";
import {gzipSync} from "fflate";
import {decodeEmulatorJsCheckpoint, encodeEmulatorJsCheckpoint} from "./checkpoint-codec.js";

const format = "emulatorjs-state-gzip-v1";
const maximum = 1024 * 1024;

describe("compressed EmulatorJS checkpoints", () => {
  it("losslessly compresses the complete state including zero-filled sections", async () => {
    const state = new Uint8Array(maximum);
    state.set([82, 65, 83, 84, 65, 84, 69, 1]);
    state[maximum - 1] = 17;
    const compressed = await encodeEmulatorJsCheckpoint(state, format, maximum);
    expect(compressed.byteLength).toBeLessThan(state.byteLength / 20);
    expect(await decodeEmulatorJsCheckpoint(compressed, format, maximum)).toEqual(state);
    expect(state[maximum - 1]).toBe(17);
  });

  it("preserves legacy raw checkpoints without guessing their format from bytes", async () => {
    const bytes = Uint8Array.of(31, 139, 8, 0, 1);
    expect(await decodeEmulatorJsCheckpoint(bytes, "emulatorjs-state-v1", maximum)).toBe(bytes);
    expect(await encodeEmulatorJsCheckpoint(bytes, "emulatorjs-state-v1", maximum)).toBe(bytes);
  });

  it("rejects truncated and corrupt gzip states", async () => {
    const bytes = gzipSync(new Uint8Array(1000));
    await expect(decodeEmulatorJsCheckpoint(bytes.slice(0, -1), format, maximum)).rejects.toThrow();
    bytes[bytes.length - 8] ^= 1;
    await expect(decodeEmulatorJsCheckpoint(bytes, format, maximum)).rejects.toThrow();
  });

  it("enforces the decoded limit even when a gzip trailer lies about its size", async () => {
    const bytes = gzipSync(new Uint8Array(maximum + 1));
    await expect(decodeEmulatorJsCheckpoint(bytes, format, maximum)).rejects.toThrow();
    new DataView(bytes.buffer).setUint32(bytes.length - 4, 1, true);
    await expect(decodeEmulatorJsCheckpoint(bytes, format, maximum)).rejects.toThrow();
  });

  it("rejects empty, oversized, and unsupported checkpoints", async () => {
    for (const state of [new Uint8Array(), new Uint8Array(maximum + 1)]) {
      await expect(encodeEmulatorJsCheckpoint(state, format, maximum)).rejects.toThrow();
      await expect(decodeEmulatorJsCheckpoint(state, "emulatorjs-state-v1", maximum)).rejects.toThrow();
    }
    await expect(decodeEmulatorJsCheckpoint(gzipSync(new Uint8Array()), format, maximum)).rejects.toThrow();
    await expect(decodeEmulatorJsCheckpoint(Uint8Array.of(1), "unknown", maximum)).rejects.toThrow();
  });
});
