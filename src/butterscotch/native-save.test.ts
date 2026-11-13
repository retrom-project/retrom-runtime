import {describe, expect, it} from "vitest";
import {sha256} from "@noble/hashes/sha2.js";
import {nativeSaves} from "./native-save.js";

const revision = (bytes: Uint8Array) => Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, "0")).join("");

describe("Butterscotch native save confirmation", () => {
  it("acknowledges the exact exported files after public compression without losing newer writes", () => {
    const saves = nativeSaves(null);
    const first = saves.capture(Uint8Array.of(1, 2)), second = saves.capture(Uint8Array.of(3, 4));
    expect(saves.availability()).toMatchObject({available: true});
    saves.acknowledge({...first, bytes: first.bytes.slice()});
    expect(saves.availability()).toMatchObject({available: true, revision: revision(second.bytes)});
    saves.acknowledge({...second, bytes: second.bytes.slice()});
    expect(saves.availability()).toMatchObject({available: false, blocker: "UNCHANGED"});
    saves.acknowledge(first);
    expect(saves.availability()).toMatchObject({available: false, blocker: "UNCHANGED"});
  });

  it("exports unconfirmed files on exit and treats imported files as already synchronized", () => {
    const bytes = Uint8Array.of(1, 2, 3), saves = nativeSaves(bytes);
    saves.update({available: true, status: "READY", revision: revision(bytes)});
    expect(saves.availability()).toMatchObject({available: false, blocker: "UNCHANGED"});
    expect(saves.final(bytes)).toBeUndefined();
    expect(saves.final(null)).toBeUndefined();
    const final = saves.final(Uint8Array.of(4, 5, 6));
    expect(final).toMatchObject({checkpoint: {bytes: Uint8Array.of(4, 5, 6),
      format: "butterscotch-game-save-v1", screenshot: "UNCHANGED"}, screenshot: null});
    saves.acknowledge(final!.checkpoint);
    expect(saves.final(Uint8Array.of(4, 5, 6))).toBeUndefined();
  });

  it("does not produce placeholder data for missing, failed, empty or oversized saves", () => {
    const saves = nativeSaves(null);
    for (const status of ["NO_SAVE", "FAILED"] as const) {
      saves.update({available: false, status});
      expect(saves.availability()).toMatchObject({available: false, blocker: status});
    }
    for (const bytes of [null, new Uint8Array(), new Uint8Array(16 * 1024 * 1024 + 1)]) {
      expect(() => saves.capture(bytes)).toThrow("BUTTERSCOTCH_NATIVE_SAVE_INVALID");
    }
  });
});
