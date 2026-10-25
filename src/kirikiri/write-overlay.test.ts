import {expect, it} from "vitest";
import {KirikiriWriteOverlay} from "./write-overlay.js";
import {maximumKirikiriCheckpointBytes, maximumKirikiriCheckpointEntries} from "./checkpoint.js";

it("keeps complete copied writes at custom Unicode user paths and replaces earlier closes", () => {
  const overlay = new KirikiriWriteOverlay(), bytes = Uint8Array.of(1, 2);
  overlay.record("/profiles/玩家/进度/data1999.ksd", bytes); bytes[0] = 7;
  expect(overlay.writes.get("profiles/玩家/进度/data1999.ksd")).toEqual(Uint8Array.of(1, 2));
  overlay.record("/profiles/玩家/进度/data1999.ksd", Uint8Array.of(3));
  expect(overlay.writes.get("profiles/玩家/进度/data1999.ksd")).toEqual(Uint8Array.of(3));
  expect(overlay.sequence).toBe(2); overlay.requireValid();
});

it.each(["/../escape.ksd", "/a/../escape.ksd", "/a\\escape.ksd"])("rejects unsafe path %s without copying it", path => {
  const overlay = new KirikiriWriteOverlay(); overlay.record(path, Uint8Array.of(1));
  expect(overlay.writes.size).toBe(0);
  expect(() => overlay.requireValid()).toThrow("KIRIKIRI_CHECKPOINT_INVALID");
});

it("does not copy an oversized write or return a partial snapshot afterwards", () => {
  const overlay = new KirikiriWriteOverlay(); overlay.record("/data.ksd", Uint8Array.of(1));
  const bytes = new Uint8Array(maximumKirikiriCheckpointBytes + 1);
  overlay.record("/large.ksd", bytes);
  expect(overlay.writes.has("large.ksd")).toBe(false);
  expect(() => overlay.requireValid()).toThrow("KIRIKIRI_CHECKPOINT_INVALID");
});

it("bounds distinct files while allowing repeated writes to a captured file", () => {
  const overlay = new KirikiriWriteOverlay();
  for (let i = 0; i < maximumKirikiriCheckpointEntries; i++) {overlay.record(`/profile/${i}`, Uint8Array.of(1));}
  overlay.record("/profile/0", Uint8Array.of(2)); overlay.requireValid();
  overlay.record("/profile/extra", Uint8Array.of(1));
  expect(overlay.writes.size).toBe(maximumKirikiriCheckpointEntries);
  expect(() => overlay.requireValid()).toThrow("KIRIKIRI_CHECKPOINT_INVALID");
});

it("requires a successful native save and nonempty correlated writes instead of a filename rule", () => {
  const overlay = new KirikiriWriteOverlay();
  overlay.record("/savedata/data0.ksd", Uint8Array.of(1));
  expect(overlay.availability()).toBe("NO_SAVE");
  overlay.observe({phase: "begin", id: 1});
  overlay.observe({phase: "end", id: 1, success: true});
  expect(overlay.availability()).toBe("NO_SAVE");
  overlay.observe({phase: "begin", id: 2});
  overlay.record("/profiles/玩家/任意名称.webp", Uint8Array.of(4, 2));
  expect(overlay.availability()).toBe("NOT_READY");
  overlay.observe({phase: "end", id: 2, success: true});
  expect([...overlay.progressPaths]).toEqual(["profiles/玩家/任意名称.webp"]);
  expect(overlay.availability()).toBe(null);
});

it("blocks failed partial writes until the same native files are successfully rewritten", () => {
  const overlay = new KirikiriWriteOverlay();
  overlay.observe({phase: "begin", id: 1}); overlay.record("/slot.bmp", Uint8Array.of(1));
  overlay.observe({phase: "end", id: 1, success: false});
  expect(overlay.availability()).toBe("NOT_READY"); expect(overlay.progressPaths.size).toBe(0);
  overlay.observe({phase: "begin", id: 2}); overlay.record("/slot.bmp", Uint8Array.of(1, 2, 3));
  overlay.observe({phase: "end", id: 2, success: true});
  expect(overlay.availability()).toBe(null);
  expect(overlay.writes.get("slot.bmp")).toEqual(Uint8Array.of(1, 2, 3));
});

it("does not dirty an acknowledged save for identical writes and retains native deletions", () => {
  const overlay = new KirikiriWriteOverlay();
  overlay.observe({phase: "begin", id: 1}); overlay.record("/slot.bmp", Uint8Array.of(1));
  overlay.observe({phase: "end", id: 1, success: true}); overlay.acknowledged = overlay.sequence;
  overlay.record("/slot.bmp", Uint8Array.of(1));
  expect(overlay.availability()).toBe("UNCHANGED");
  overlay.record("/slot.bmp", null);
  expect(overlay.availability()).toBe(null);
  expect(overlay.writes.get("slot.bmp")).toBeNull();
});

it("bounds and rejects mismatched native observation events", () => {
  const overlay = new KirikiriWriteOverlay();
  overlay.observe({phase: "end", id: 1, success: true});
  expect(() => overlay.requireValid()).toThrow("KIRIKIRI_SAVE_OBSERVER_INVALID");
  const bounded = new KirikiriWriteOverlay();
  for (let id = 1; id <= 33; id++) {bounded.observe({phase: "begin", id});}
  expect(() => bounded.requireValid()).toThrow("KIRIKIRI_SAVE_OBSERVER_INVALID");
});

it("preserves exact decomposed Unicode virtual paths without silently renaming a native file", () => {
  const overlay = new KirikiriWriteOverlay(), path = "profiles/e\u0301/slot.bmp";
  overlay.observe({phase: "begin", id: 1}); overlay.record("/" + path, Uint8Array.of(1));
  overlay.observe({phase: "end", id: 1, success: true});
  expect([...overlay.writes.keys()]).toEqual([path]);
  expect([...overlay.progressPaths]).toEqual([path]);
});

it("allows a later native save when a failed call already removed its temporary files", () => {
  const overlay = new KirikiriWriteOverlay();
  overlay.observe({phase: "begin", id: 1});
  overlay.record("/native.tmp", Uint8Array.of(1)); overlay.record("/native.tmp", null);
  overlay.observe({phase: "end", id: 1, success: false});
  expect(overlay.availability()).toBe("NO_SAVE");
  overlay.observe({phase: "begin", id: 2}); overlay.record("/slot.bmp", Uint8Array.of(4, 2));
  overlay.observe({phase: "end", id: 2, success: true});
  expect(overlay.availability()).toBe(null);
});
