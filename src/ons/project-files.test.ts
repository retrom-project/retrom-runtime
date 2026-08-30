import { afterEach, describe, expect, it, vi } from "vitest";

import { createOnsProjectFileMap } from "./project-files.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ONS project file loading", () => {
  it("deletes an inexact persisted entry and replaces it from the network", async () => {
    const url = "https://content.example/arc.nsa";
    const storage = new MemoryCacheStorage();
    await storage.cache.put(url, new Response(Uint8Array.of(9)));
    vi.stubGlobal("caches", storage);
    const fetchMock = vi.fn(async () => new Response(Uint8Array.of(1, 2, 3, 4), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const writes: Uint8Array[] = [];
    const progress: number[] = [];
    const project = createOnsProjectFileMap(
      [{ path: "arc.nsa", sizeBytes: 4, url }],
      window,
      (event) => progress.push(event.loadedBytes),
    );

    await expect(project.fetchFile({ writeFile: (_, bytes) => writes.push(bytes.slice()) }, "/game/arc.nsa"))
      .resolves.toBe(1);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(writes).toEqual([Uint8Array.of(1, 2, 3, 4)]);
    expect(progress).toContain(0);
    expect(progress.at(-1)).toBe(4);
    await expect((await storage.cache.match(url))?.arrayBuffer()).resolves
      .toEqual(Uint8Array.of(1, 2, 3, 4).buffer);
  });

  it("retries a failed exact-size network read when persistent storage is unavailable", async () => {
    vi.stubGlobal("caches", { open: async () => {throw new Error("quota");} });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(Uint8Array.of(1), { status: 200 }))
      .mockResolvedValueOnce(new Response(Uint8Array.of(1, 2), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const writes: Uint8Array[] = [];
    const project = createOnsProjectFileMap(
      [{ path: "arc.nsa", sizeBytes: 2, url: "https://content.example/arc.nsa" }],
      window,
      () => undefined,
    );
    const writer = { writeFile: (_: string, bytes: Uint8Array) => writes.push(bytes.slice()) };

    await expect(project.fetchFile(writer, "/game/arc.nsa")).resolves.toBe(-1);
    await expect(project.fetchFile(writer, "/game/arc.nsa")).resolves.toBe(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(writes).toEqual([Uint8Array.of(1, 2)]);
  });

  it("does not lose a large project entry when the cache backend rejects concurrent writes", async () => {
    const files = [
      { path: "arc.nsa", sizeBytes: 2, url: "https://content.example/arc.nsa" },
      { path: "arc1.nsa", sizeBytes: 2, url: "https://content.example/arc1.nsa" },
    ];
    const storage = new SingleWriterCacheStorage();
    vi.stubGlobal("caches", storage);
    const fetchMock = vi.fn(async () => new Response(Uint8Array.of(1, 2), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    for (let run = 0; run < 2; run += 1) {
      const project = createOnsProjectFileMap(files, window, () => undefined);
      await Promise.all(files.map((file) => project.fetchFile(
        { writeFile: () => undefined }, `/game/${file.path}`,
      )));
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

class MemoryCacheStorage {
  readonly cache = new MemoryCache();
  async open() {return this.cache;}
}

class MemoryCache {
  private readonly responses = new Map<string, Response>();
  async delete(request: RequestInfo | URL) {return this.responses.delete(String(request));}
  async match(request: RequestInfo | URL) {return this.responses.get(String(request))?.clone();}
  async put(request: RequestInfo | URL, response: Response) {
    this.responses.set(String(request), response.clone());
  }
}

class SingleWriterCacheStorage {
  readonly cache = new SingleWriterCache();
  async open() {return this.cache;}
}

class SingleWriterCache extends MemoryCache {
  private activeWrites = 0;
  override async put(request: RequestInfo | URL, response: Response) {
    this.activeWrites += 1;
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (this.activeWrites > 1) {throw new Error("concurrent cache write rejected");}
      await super.put(request, response);
    } finally {
      this.activeWrites -= 1;
    }
  }
}
