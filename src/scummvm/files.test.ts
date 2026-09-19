// @vitest-environment node
import {afterEach, describe, expect, it, vi} from "vitest";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
import {ScummvmFiles, blockSize as B} from "./files.js";
const digest = "a".repeat(64);
const index = {schemaVersion: 1, files: [{path: "Folder/Game.dat", sizeBytes: 3 * B, url: "https://games.test/content/data"}]};
const cleanups: (() => Promise<void>)[] = [];
function fixture() {
  const content = contentSessionFixture("https://games.test"); cleanups.push(content.close);
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    const [start, end] = new Headers(options?.headers).get("Range")!.slice(6).split("-").map(Number);
    const response = new Response(new Uint8Array(end - start + 1).fill(start / B + 1), {status: 206, headers: {
      "Content-Range": `bytes ${start}-${end}/${3 * B}`, ETag: '"immutable-index-entry"'}});
    Object.defineProperty(response, "url", {value: String(url)}); return response;
  });
  vi.stubGlobal("fetch", fetcher);
  return {...content, fetcher, make: (value = index, identity = digest) => new ScummvmFiles(value, identity, content.session)};
}
afterEach(async () => {await Promise.all(cleanups.splice(0).map(close => close())); vi.unstubAllGlobals();});
describe("ScummVM public content files", () => {
  it("[IO-01] UNIT/scummvm [IO-02] UNIT/scummvm stat/list do not open content and lazy reads retain index semantics", async () => {
    const f = fixture(), files = f.make();
    expect(files.stat("/game/Folder")).toBe(-1); expect(files.stat("/game/nope")).toBe(-2); expect(files.list("/game")).toEqual(["Folder"]);
    expect(f.files.size).toBe(0); expect(f.fetcher).not.toHaveBeenCalled();
    expect(await files.read("/game/Folder/Game.dat", B - 2, 4)).toEqual(new Uint8Array([1, 1, 2, 2]));
    expect(f.fetcher.mock.calls.map(([, options]) => new Headers(options?.headers).get("Range")))
      .toEqual([`bytes=0-${B - 1}`, `bytes=${B}-${2 * B - 1}`]);
    expect(new Headers(f.fetcher.mock.calls[1][1]?.headers).get("If-Match")).toBe('"immutable-index-entry"');
    await files.close(); expect(f.files.size).toBe(0); await expect(files.read("/game/Folder/Game.dat", 0, 0)).rejects.toThrow("ABORTED");
  });
  it("[IO-06] UNIT/scummvm [IO-21] UNIT/scummvm shared public cache separates different index identities", async () => {
    const f = fixture(), first = f.make(), second = f.make(), foreign = f.make(index, "b".repeat(64));
    await first.read("/game/Folder/Game.dat", 4, 4); await second.read("/game/Folder/Game.dat", 0, 20);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    await foreign.read("/game/Folder/Game.dat", 0, 1); expect(f.fetcher).toHaveBeenCalledTimes(2);
    await Promise.all([first.close(), second.close(), foreign.close()]);
  });
  it.each(["../outside", "/absolute", "folder/../game", "Folder//game", "Folder\\game"])("rejects unsafe path %s", path => {
    const f = fixture(); expect(() => f.make({schemaVersion: 1, files: [{...index.files[0], path}]})).toThrow("SCUMMVM_INDEX_INVALID");
  });
  it("rejects case collisions and files colliding with directories", () => {
    const f = fixture();
    for (const path of ["folder/game.dat", "folder"]) {expect(() => f.make({schemaVersion: 1, files: [...index.files, {...index.files[0], path}]})).toThrow("SCUMMVM_INDEX_INVALID");}
  });
  it("[X-27] UNIT/scummvm game blocks require a strong first ETag", async () => {
    const f = fixture(); f.fetcher.mockImplementation(async url => {
      const response = new Response(new Uint8Array(B), {status: 206, headers: {"Content-Range": `bytes 0-${B - 1}/${3 * B}`}});
      Object.defineProperty(response, "url", {value: String(url)}); return response;
    });
    await expect(f.make().read("/game/Folder/Game.dat", 0, 1)).rejects.toThrow("IDENTITY_CHANGED");
  });
  it("[X-27] UNIT/scummvm only preverified CORE_ASSET data can read without an ETag", async () => {
    const f = fixture(); f.fetcher.mockImplementation(async url => {
      const response = new Response(new Uint8Array(B).fill(17), {status: 206, headers: {"Content-Range": `bytes 0-${B - 1}/${3 * B}`}});
      Object.defineProperty(response, "url", {value: String(url)}); return response;
    });
    const files = new ScummvmFiles(index, digest, f.session, undefined, "/data", new Map([["Folder/Game.dat", "b".repeat(64)]]));
    expect(await files.read("/data/Folder/Game.dat", 0, 1)).toEqual(new Uint8Array([17])); await files.close();
  });
  it("[IO-03] UNIT/scummvm empty files and exact EOF reads do not fetch while invalid bounds fail", async () => {
    const f = fixture(), files = f.make({schemaVersion: 1, files: [{...index.files[0], sizeBytes: 0}]});
    expect(files.stat("/game/Folder/Game.dat")).toBe(0);
    expect(await files.read("/game/Folder/Game.dat", 0, 0)).toEqual(new Uint8Array());
    await expect(files.read("/game/Folder/Game.dat", 1, 0)).rejects.toThrow("BOUNDS");
    await expect(files.read("/game/Folder/Game.dat", 0, 1)).rejects.toThrow("BOUNDS");
    const normal = f.make(); expect(await normal.read("/game/Folder/Game.dat", 3 * B, 0)).toEqual(new Uint8Array());
    expect(f.fetcher).not.toHaveBeenCalled(); await files.close(); await normal.close();
  });
  it("[ST-17] UNIT/scummvm URL renewal reuses identity while logical paths remain separate", async () => {
    const f = fixture(), first = f.make(); await first.read("/game/Folder/Game.dat", 0, 1);
    const renewed = f.make({schemaVersion: 1, files: [{...index.files[0], url: `${index.files[0].url}?authorization=renewed`}]});
    expect(await renewed.read("/game/Folder/Game.dat", 0, 1)).toEqual(new Uint8Array([1]));
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const foreign = f.make({schemaVersion: 1, files: [{...index.files[0], path: "other.dat"}]});
    await foreign.read("/game/other.dat", 0, 1); expect(f.fetcher).toHaveBeenCalledTimes(2);
    await Promise.all([first.close(), renewed.close(), foreign.close()]);
  });
  it("[X-30] UNIT/scummvm-existing-read-limit preserves the existing block-sized native facade", async () => {
    const f = fixture(), files = f.make();
    await expect(files.read("/game/Folder/Game.dat", 0, 17 * 1024 * 1024)).rejects.toThrow("BOUNDS");
    expect(f.fetcher).not.toHaveBeenCalled(); expect((await files.read("/game/Folder/Game.dat", 0, B)).length).toBe(B);
    await files.close();
  });
});
