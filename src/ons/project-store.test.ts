import { describe, expect, it, vi } from "vitest";

import { openOnsProjectStore } from "./project-store.js";

describe("ONS persistent project store", () => {
  it("prefers origin-private files so oversized project archives bypass Cache Storage entry limits", async () => {
    const directory = new MemoryDirectory();
    const cacheOpen = vi.fn(async () => {throw new Error("Cache Storage must not be used");});
    const frameWindow = {
      caches: { open: cacheOpen },
      crypto: globalThis.crypto,
      navigator: { storage: { getDirectory: async () => directory } },
    } as unknown as Window;
    const store = await openOnsProjectStore(frameWindow);
    const url = "https://content.example/immutable/arc5.nsa";

    await store?.put(url, Uint8Array.of(1, 2, 3, 4));
    const response = await store?.match(url);

    expect(cacheOpen).not.toHaveBeenCalled();
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3, 4));
    await store?.delete(url);
    await expect(store?.match(url)).resolves.toBeNull();
  });
});

class MemoryDirectory {
  private readonly files = new Map<string, Uint8Array>();

  async getDirectoryHandle() {return this;}
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) {throw new DOMException("missing", "NotFoundError");}
    return {
      createWritable: async () => ({
        abort: async () => {this.files.delete(name);},
        close: async () => undefined,
        write: async (value: Uint8Array) => {this.files.set(name, value.slice());},
      }),
      getFile: async () => this.files.get(name) ?? new Uint8Array(),
    };
  }
  async removeEntry(name: string) {
    if (!this.files.delete(name)) {throw new DOMException("missing", "NotFoundError");}
  }
}
