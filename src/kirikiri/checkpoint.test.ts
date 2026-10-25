import { describe, expect, it } from "vitest";

import { decodeKirikiriCheckpoint, encodeKirikiriCheckpoint, kirikiriCheckpointMagic } from "./checkpoint.js";

describe("KiriKiri checkpoint codec", () => {
  it("round-trips a deterministic KAG save bundle", async () => {
    const encoded = await encodeKirikiriCheckpoint({
      entries: [
        { path: "savedata/data0.png", data: Uint8Array.of(2, 6) },
        { path: "savedata/datasu.ksd", data: Uint8Array.of(3, 1, 4) },
      ],
      progressPaths: ["savedata/data0.png"],
    });

    expect(new TextDecoder().decode(encoded.subarray(0, kirikiriCheckpointMagic.length)))
      .toBe(kirikiriCheckpointMagic);
    const decoded = await decodeKirikiriCheckpoint(encoded);
    expect(decoded.progressPaths).toEqual(["savedata/data0.png"]);
    expect(decoded.entries.map((entry) => entry.path)).toEqual([
      "savedata/data0.png", "savedata/datasu.ksd",
    ]);
    expect(decoded.entries[0]!.data).toEqual(Uint8Array.of(2, 6));
  });

  it("rejects traversal, duplicate and changed payloads", async () => {
    await expect(encodeKirikiriCheckpoint({
      entries: [{ path: "../data0.png", data: Uint8Array.of(1) }],
      progressPaths: ["savedata/data0.png"],
    })).rejects.toThrow("KIRIKIRI_CHECKPOINT_INVALID");
    await expect(encodeKirikiriCheckpoint({
      entries: [
        { path: "savedata/data0.png", data: Uint8Array.of(1) },
        { path: "savedata/data0.png", data: Uint8Array.of(2) },
      ],
      progressPaths: ["savedata/data0.png"],
    })).rejects.toThrow("KIRIKIRI_CHECKPOINT_INVALID");

    const encoded = await encodeKirikiriCheckpoint({
      entries: [{ path: "savedata/data0.png", data: Uint8Array.of(7, 8) }],
      progressPaths: ["savedata/data0.png"],
    });
    encoded[encoded.length - 1] ^= 1;
    await expect(decodeKirikiriCheckpoint(encoded)).rejects.toThrow("KIRIKIRI_CHECKPOINT_INVALID");
  });

  it("round-trips file deletion without resurrecting a native slot", async () => {
    const bundle = {progressPaths: ["profiles/玩家/slot.bmp"], entries: [
      {path: "profiles/玩家/slot.bmp", data: null},
      {path: "profiles/玩家/options.ksd", data: Uint8Array.of(1)},
    ]};
    const encoded = await encodeKirikiriCheckpoint(bundle);
    expect(await decodeKirikiriCheckpoint(encoded)).toEqual({...bundle, entries: bundle.entries.slice().reverse()});
    expect(await encodeKirikiriCheckpoint({...bundle, entries: bundle.entries.slice().reverse()})).toEqual(encoded);
  });

  it("preserves exact Unicode spellings used by the native virtual filesystem", async () => {
    const path = "profiles/e\u0301/slot.bmp";
    const encoded = await encodeKirikiriCheckpoint({progressPaths: [path], entries: [{path, data: Uint8Array.of(4, 2)}]});
    expect((await decodeKirikiriCheckpoint(encoded)).entries[0]?.path).toBe(path);
  });

  it.each([[], ["missing.dat"], ["slot.png", "slot.png"]].map(progressPaths => ({progressPaths})))("rejects invalid native progress references $progressPaths", async ({progressPaths}) => {
    await expect(encodeKirikiriCheckpoint({progressPaths, entries: [{path: "slot.png", data: Uint8Array.of(1)}]}))
      .rejects.toThrow("KIRIKIRI_CHECKPOINT_INVALID");
  });
});
