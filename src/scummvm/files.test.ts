import {describe, expect, it, vi} from "vitest";
import {ScummvmFiles, blockSize} from "./files.js";

const digest = "a".repeat(64);
const index = {schemaVersion: 1, files: [{path: "Folder/Game.dat", sizeBytes: 3 * blockSize, url: "https://games.test/content/data"}]};

function network() {
  return vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    const range = new Headers(options?.headers).get("Range")!;
    const [, start, end] = /^bytes=(\d+)-(\d+)$/u.exec(range)!;
    const bytes = new Uint8Array(Number(end) - Number(start) + 1).fill(Number(start) / blockSize + 1);
    return new Response(bytes, {status: 206, headers: {"Content-Range": `bytes ${start}-${end}/${3 * blockSize}`}});
  });
}

function cache() {
  const values = new Map<string, Response>();
  return {
    match: vi.fn(async (key: string) => values.get(key)?.clone()),
    put: vi.fn(async (key: string, value: Response) => {values.set(key, value.clone());}),
    delete: vi.fn(async (key: string) => values.delete(key)),
  };
}

describe("ScummVM seekable game files", () => {
  it("indexes directories without downloading content and reads bounded blocks across a seek", async () => {
    const fetcher = network();
    const files = new ScummvmFiles(index, digest, fetcher, null);
    expect(files.stat("/game/Folder")).toBe(-1);
    expect(files.list("/game")).toEqual(["Folder"]);
    expect(fetcher).not.toHaveBeenCalled();
    const bytes = await files.read("/game/Folder/Game.dat", blockSize - 2, 4);
    expect([...bytes]).toEqual([1, 1, 2, 2]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map((call) => new Headers(call[1]?.headers).get("Range")))
      .toEqual([`bytes=0-${blockSize - 1}`, `bytes=${blockSize}-${2 * blockSize - 1}`]);
  });

  it("reuses persistent blocks in another launch while separating different content identities", async () => {
    const fetcher = network();
    const store = cache();
    await new ScummvmFiles(index, digest, fetcher, store).read("/game/Folder/Game.dat", 4, 4);
    await new ScummvmFiles(index, digest, fetcher, store).read("/game/Folder/Game.dat", 0, 20);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await new ScummvmFiles(index, "b".repeat(64), fetcher, store).read("/game/Folder/Game.dat", 0, 1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects servers ignoring Range before reading a large response body", async () => {
    const response = new Response(new Uint8Array(1), {status: 200});
    const read = vi.spyOn(response, "arrayBuffer");
    const fetcher = vi.fn(async () => response);
    await expect(new ScummvmFiles(index, digest, fetcher, null).read("/game/Folder/Game.dat", 0, 1))
      .rejects.toThrow("SCUMMVM_RANGE_INVALID");
    expect(read).not.toHaveBeenCalled();
  });

  it("continues network reads if persistent storage fails", async () => {
    const fetcher = network();
    const store = cache();
    store.match.mockRejectedValue(new Error("unavailable"));
    store.put.mockRejectedValue(new Error("quota"));
    expect(await new ScummvmFiles(index, digest, fetcher, store).read("/game/Folder/Game.dat", 0, 1))
      .toEqual(new Uint8Array([1]));
  });

  it.each(["../outside", "/absolute", "folder/../game", "Folder//game", "Folder\\game"])("rejects unsafe paths: %s", (path) => {
      expect(() => new ScummvmFiles({schemaVersion: 1, files: [{...index.files[0], path}]}, digest, network(), null))
        .toThrow("SCUMMVM_INDEX_INVALID");
    });

  it("rejects short, oversized and mismatched Range responses", async () => {
    for (const response of [
      new Response(new Uint8Array(2), {status: 206, headers: {"Content-Range": `bytes 0-${blockSize - 1}/${3 * blockSize}`}}),
      new Response(new Uint8Array(blockSize + 1), {status: 206, headers: {"Content-Range": `bytes 0-${blockSize - 1}/${3 * blockSize}`}}),
      new Response(new Uint8Array(blockSize), {status: 206, headers: {"Content-Range": `bytes 1-${blockSize}/${3 * blockSize}`}}),
    ]) {
      await expect(new ScummvmFiles(index, digest, async () => response, null).read("/game/Folder/Game.dat", 0, 1))
        .rejects.toThrow("SCUMMVM_RANGE_INVALID");
    }
  });
});
