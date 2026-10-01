import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {zipSync} from "fflate";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
import {mameArcadeTarget} from "../providers/retrom-runtime/mame-declaration.js";
import {mountFiles} from "./files.js";

const owners: ReturnType<typeof contentSessionFixture>[] = [];
afterEach(async () => {
  await Promise.all(owners.splice(0).map(owner => owner.close()));
  vi.unstubAllGlobals();
});

function fixture() {
  const game = new Uint8Array(40), member = new Uint8Array([1, 2, 3]);
  const parent = zipSync({"puckman.zip": member}, {level: 0});
  const file = (name: string, bytes: Uint8Array) => ({url: `http://localhost/${name}`,
    sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length});
  const config = {arcade: true as const, machine: "mspacman", game: file("game", game),
    parent: file("parent", parent), bios: null, deviceBios: [], runtimeBaseUrl: "/provider/"};
  const owner = contentSessionFixture("http://localhost", undefined, "mame-arcade"); owners.push(owner);
  const fetcher = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const isParent = url.endsWith("/parent"), source = isParent ? config.parent : config.game;
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

it("verifies and materializes parent through the shared session before mounting nested archives", async () => {
  const f = fixture(), materialize = vi.spyOn(f.owner.session, "materialize"), progress = vi.fn();
  await mountFiles(f.core, f.config, {assetIndex: {}, contentSession: f.owner.session, reportProgress: progress});
  expect(materialize).toHaveBeenCalledTimes(2);
  expect(f.fetcher.mock.calls.map(([url]) => String(url))).toEqual([f.config.game.url, f.config.parent.url]);
  expect(f.core.FS.writeFile).toHaveBeenCalledWith("/content/roms/puckman.zip", f.member);
  expect(progress).toHaveBeenLastCalledWith({phase: "PROJECT_CONTENT", loadedBytes: f.parent.length, totalBytes: f.parent.length});
  expect(f.owner.files.size).toBe(0);
});

it.each(["checksum", "length"])("rejects parent %s mismatch before publishing any MAME files", async failure => {
  const f = fixture();
  if (failure === "checksum") {f.config.parent.sha256 = "0".repeat(64);} else {f.config.parent.sizeBytes++;}
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
