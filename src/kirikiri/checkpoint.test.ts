import { describe, expect, it } from "vitest";

import { decodeKirikiriCheckpoint, encodeKirikiriCheckpoint, kirikiriCheckpointMagic } from "./checkpoint.js";

describe("KiriKiri checkpoint codec", () => {
  it("round-trips a deterministic KAG save bundle", async () => {
    const encoded = await encodeKirikiriCheckpoint({
      entries: [
        { path: "savedata/data1999.ksd", data: Uint8Array.of(2, 6) },
        { path: "savedata/datasu.ksd", data: Uint8Array.of(3, 1, 4) },
      ],
      resumeSlot: 1999,
    });

    expect(new TextDecoder().decode(encoded.subarray(0, kirikiriCheckpointMagic.length)))
      .toBe(kirikiriCheckpointMagic);
    const decoded = await decodeKirikiriCheckpoint(encoded);
    expect(decoded.resumeSlot).toBe(1999);
    expect(decoded.entries.map((entry) => entry.path)).toEqual([
      "savedata/data1999.ksd", "savedata/datasu.ksd",
    ]);
    expect([...decoded.entries[0]!.data]).toEqual([2, 6]);
  });

  it("rejects traversal, duplicate and changed payloads", async () => {
    await expect(encodeKirikiriCheckpoint({
      entries: [{ path: "../data1999.ksd", data: Uint8Array.of(1) }],
      resumeSlot: 1999,
    })).rejects.toThrow("KIRIKIRI_CHECKPOINT_INVALID");
    await expect(encodeKirikiriCheckpoint({
      entries: [
        { path: "savedata/data1999.ksd", data: Uint8Array.of(1) },
        { path: "savedata/data1999.ksd", data: Uint8Array.of(2) },
      ],
      resumeSlot: 1999,
    })).rejects.toThrow("KIRIKIRI_CHECKPOINT_INVALID");

    const encoded = await encodeKirikiriCheckpoint({
      entries: [{ path: "savedata/data1999.ksd", data: Uint8Array.of(7, 8) }],
      resumeSlot: 1999,
    });
    encoded[encoded.length - 1] ^= 1;
    await expect(decodeKirikiriCheckpoint(encoded)).rejects.toThrow("KIRIKIRI_CHECKPOINT_INVALID");
  });
});
