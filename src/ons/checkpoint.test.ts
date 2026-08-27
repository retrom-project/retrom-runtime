import { describe, expect, it } from "vitest";

import { decodeOnsCheckpoint, encodeOnsCheckpoint, onsCheckpointMagic } from "./checkpoint.js";

describe("ONS checkpoint codec", () => {
  it("round-trips a deterministic save directory", async () => {
    const encoded = await encodeOnsCheckpoint({
      entries: [
        { path: "セーブ.dat", data: Uint8Array.of(2, 6) },
        { path: "save999.dat", data: Uint8Array.of(3, 1, 4) },
        { path: "envdata", data: Uint8Array.of(1, 5, 9) },
      ],
      resumeSlot: 999,
    });

    expect(new TextDecoder().decode(encoded.subarray(0, onsCheckpointMagic.length))).toBe(onsCheckpointMagic);
    const decoded = await decodeOnsCheckpoint(encoded);
    expect(decoded.resumeSlot).toBe(999);
    expect(decoded.entries.map((entry) => entry.path)).toEqual(["envdata", "save999.dat", "セーブ.dat"]);
    expect([...decoded.entries[1]!.data]).toEqual([3, 1, 4]);
  });

  it("rejects traversal, duplicate and changed payloads", async () => {
    await expect(encodeOnsCheckpoint({
      entries: [{ path: "../save.dat", data: Uint8Array.of(1) }],
      resumeSlot: 999,
    })).rejects.toThrow("ONS_CHECKPOINT_INVALID");
    await expect(encodeOnsCheckpoint({
      entries: [
        { path: "save.dat", data: Uint8Array.of(1) },
        { path: "save.dat", data: Uint8Array.of(2) },
      ],
      resumeSlot: 999,
    })).rejects.toThrow("ONS_CHECKPOINT_INVALID");

    const encoded = await encodeOnsCheckpoint({
      entries: [{ path: "save999.dat", data: Uint8Array.of(7, 8) }],
      resumeSlot: 999,
    });
    encoded[encoded.length - 1] ^= 1;
    await expect(decodeOnsCheckpoint(encoded)).rejects.toThrow("ONS_CHECKPOINT_INVALID");
  });
});
