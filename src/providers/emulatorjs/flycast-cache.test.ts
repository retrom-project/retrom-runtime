// @vitest-environment node
import {createHash} from "node:crypto";
import {describe, expect, it, vi} from "vitest";
import {loadFlycastDisc} from "./flycast-cache.js";

const bytes = new Uint8Array([1, 2, 3, 4]);
const game = {url: "https://example.test/content/game.chd", sizeBytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex")};
function storage() {
  let saved = new Blob();
  const root = {
    getFileHandle: async () => ({getFile: async () => saved,
      createWritable: async () => {
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        return {write: async (chunk: Uint8Array<ArrayBuffer>) => {chunks.push(chunk);},
          close: async () => {saved = new Blob(chunks);}, abort: async () => {}};
      }}), removeEntry: async () => {saved = new Blob();},
  };
  return {directory: async () => root, corrupt: () => {saved = new Blob([new Uint8Array([0, 0, 0, 0])]);}};
}
function network() {return vi.fn(async () => new Response(bytes));}
describe("Flycast immutable CHD cache", () => {
  it("streams once across two runtime instances and rejects corrupt cached bytes", async () => {
    const cache = storage(), fetchBytes = network(), progress = vi.fn();
    const options = {...cache, fetchBytes};
    for (let instance = 0; instance < 2; instance++) {
      const result = await loadFlycastDisc(game, new AbortController().signal, progress, options);
      expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
    }
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(4, 4);
    cache.corrupt();
    await loadFlycastDisc(game, new AbortController().signal, progress, options);
    expect(fetchBytes).toHaveBeenCalledTimes(2);
  });
  it("falls back to a validated network read when OPFS is unavailable", async () => {
    const fetchBytes = network();
    const result = await loadFlycastDisc(game, new AbortController().signal, vi.fn(), {
      directory: async () => {throw Error("unavailable");}, fetchBytes,
    });
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
  });
  it("aborts a failed cache write and retries with validated memory bytes", async () => {
    const fetchBytes = network(), abort = vi.fn(async () => {}), removeEntry = vi.fn(async () => {});
    const result = await loadFlycastDisc(game, new AbortController().signal, vi.fn(), {
      fetchBytes, directory: async () => ({removeEntry, getFileHandle: async () => ({
        getFile: async () => new Blob(), createWritable: async () => ({
          write: async () => {throw new DOMException("full", "QuotaExceededError");}, close: vi.fn(), abort,
        }),
      })}),
    });
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
    expect(fetchBytes).toHaveBeenCalledTimes(2);
    expect(abort).toHaveBeenCalledOnce();
    expect(removeEntry).toHaveBeenCalled();
  });
  it.each([new Uint8Array([1]), new Uint8Array([1, 2, 3, 4, 5]), new Uint8Array([0, 0, 0, 0])])(
    "rejects short, oversized and incorrect network content", async (data) => {
      await expect(loadFlycastDisc(game, new AbortController().signal, vi.fn(), {
        ...storage(), fetchBytes: async () => new Response(data),
      })).rejects.toThrow("FLYCAST_DISC_INTEGRITY_INVALID");
    },
  );
  it("does not request content after cancellation", async () => {
    const abort = new AbortController(); abort.abort(); const fetchBytes = network();
    await expect(loadFlycastDisc(game, abort.signal, vi.fn(), {...storage(), fetchBytes})).rejects.toThrow();
    expect(fetchBytes).not.toHaveBeenCalled();
  });
});
