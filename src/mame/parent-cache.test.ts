import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
import {mameArcadeTarget} from "../providers/retrom-runtime/mame-declaration.js";
import {mountFiles} from "./files.js";
import {decodeState, encodeState} from "./state.js";

const owners: ReturnType<typeof contentSessionFixture>[] = [];
afterEach(async () => {
  await Promise.all(owners.splice(0).map(owner => owner.close()));
  vi.unstubAllGlobals();
});

function fixture(member = new Uint8Array([1, 2, 3])) {
  const game = new Uint8Array(40);
  const parent = member;
  const file = (name: string, bytes: Uint8Array) => ({url: `http://localhost/${name}`,
    sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length});
  const config = {arcade: true as const, machine: "pacman", game: file("game", game),
    parents: [{...file("parent", parent), logicalName: "stored/puckman.zip", virtualPath: "puckman.zip"}], deviceBios: [], runtimeBaseUrl: "/provider/"};
  const owner = contentSessionFixture("http://localhost", undefined, "mame-arcade"); owners.push(owner);
  const fetcher = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const isParent = url.endsWith("/parent"), source = isParent ? config.parents[0] : config.game;
    const response = new Response(isParent ? parent : game, {headers: {
      ETag: `"sha256-${source.sha256}"`, "Content-Length": String(source.sizeBytes),
    }});
    Object.defineProperty(response, "url", {value: url}); return response;
  });
  vi.stubGlobal("fetch", fetcher);
  const core = {FS: {mkdirTree: vi.fn(), writeFile: vi.fn(), chmod: vi.fn(), ignorePermissions: true}};
  return {config, owner, core, fetcher, member, parent};
}

it("declares MAME Current parent archives as bounded managed content", () => {
  expect(mameArcadeTarget.contentIO.parent).toMatchObject({mode: "EAGER", result: "BYTES", maxFileBytes: 128 * 1024 * 1024});
});

it("verifies and materializes parent through the shared session before mounting original archives", async () => {
  const f = fixture(), materialize = vi.spyOn(f.owner.session, "materialize"), progress = vi.fn();
  await mountFiles(f.core, f.config, {assetIndex: {}, contentSession: f.owner.session, reportProgress: progress});
  expect(materialize).toHaveBeenCalledTimes(2);
  expect(f.fetcher.mock.calls.map(([url]) => String(url))).toEqual([f.config.game.url, f.config.parents[0].url]);
  expect(f.core.FS.writeFile).toHaveBeenCalledWith("/content/roms/puckman.zip", f.member);
  expect(progress).toHaveBeenLastCalledWith({phase: "PROJECT_CONTENT", loadedBytes: f.parent.length, totalBytes: f.parent.length});
  expect(f.owner.files.size).toBe(0);
});

it.each(["checksum", "length"])("rejects parent %s mismatch before publishing any MAME files", async failure => {
  const f = fixture();
  if (failure === "checksum") {f.config.parents[0].sha256 = "0".repeat(64);} else {f.config.parents[0].sizeBytes++;}
  await expect(mountFiles(f.core, f.config, {assetIndex: {}, contentSession: f.owner.session}))
    .rejects.toThrow(failure === "checksum" ? "CHECKSUM_MISMATCH" : "LENGTH_MISMATCH");
  expect(f.core.FS.writeFile).not.toHaveBeenCalled();
  expect(f.owner.files.size).toBe(0);
});

it("does not fetch or mount after startup cancellation", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await expect(mountFiles(f.core, f.config, {assetIndex: {}, contentSession: f.owner.session, signal: controller.signal})).rejects.toThrow();
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.core.FS.writeFile).not.toHaveBeenCalled();
  expect(f.owner.files.size).toBe(0);
});

// Published v1 checkpoint vector: pacman, 40 zero game bytes, puckman.zip=[1,2,3], no BIOS.
const publishedIdentity = "89271a817bbc1b7ec30402a31e1bb404479d0475e5dc49e6ab2df9586df28ac9";
const build = "b".repeat(64), native = new Uint8Array([4, 5, 6]);

it("restores published parent checkpoints after correcting the transport ZIP digest", async () => {
  const f = fixture(), state = await encodeState(publishedIdentity, build, native);
  const identity = await mountFiles(f.core, f.config, {assetIndex: {}, contentSession: f.owner.session});
  expect(await decodeState(identity, build, state)).toEqual(native);
  expect(identity).toBe(publishedIdentity);
});

it("still rejects a checkpoint when parent member content changes", async () => {
  const f = fixture(new Uint8Array([1, 2, 4])), state = await encodeState(publishedIdentity, build, native);
  const identity = await mountFiles(f.core, f.config, {assetIndex: {}, contentSession: f.owner.session});
  await expect(decodeState(identity, build, state)).rejects.toThrow("MAME_CHECKPOINT_INVALID");
});
