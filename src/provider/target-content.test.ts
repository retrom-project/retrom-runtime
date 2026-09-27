import {expect, it, vi} from "vitest";
import {bindTargetContent} from "./target-content.js";
import {eagerPolicy, rangePolicy} from "./content-policies.js";
import {fetchMedia} from "../webmsx/fetch.js";

it("carries the exact declared policy into the adapter, including bounds and writes", async () => {
  const close = vi.fn(), raw = {open: vi.fn(async () => ({id: "game", close})), closeFile: vi.fn(),
    materialize: vi.fn(async () => ({kind: "BYTES", bytes: new Uint8Array(8)}))};
  const policy = eagerPolicy(9, {writes: "SESSION_OVERLAY"});
  const session = bindTargetContent(raw as never, {contentIO: {game: policy}});
  await fetchMedia({mediaUrl: "https://game.test/disc.dsk", mediaSizeBytes: 8, contentDigest: "a".repeat(64)}, vi.fn(), session);
  expect(raw.open.mock.calls[0]).toEqual([expect.objectContaining({purpose: "GAME"}), policy, undefined]);
  expect(raw.materialize).toHaveBeenCalledWith("game", {kind: "BYTES", maxBytes: 9}, undefined, expect.any(Function));
  expect(close).toHaveBeenCalledOnce();
});

it("requires an explicitly declared member and refuses external loader policies", () => {
  const support = eagerPolicy(8), game = rangePolicy("ASYNC", 100);
  const session = bindTargetContent({open: vi.fn(), materialize: vi.fn(), closeFile: vi.fn()}, {
    contentIO: {game, bios: {mode: "UPSTREAM_LOADER", boundaryId: "emulatorjs-loader"}}, contentMembers: {game: {support}},
  });
  expect(session.inputPolicy("game")).toBe(game);
  expect(session.inputPolicy("game", "support")).toBe(support);
  expect(() => session.inputPolicy("game", "missing")).toThrow("CONTENT_IO_SOURCE_INVALID");
  expect(() => session.inputPolicy("bios")).toThrow("CONTENT_IO_SOURCE_INVALID");
});
