import { describe, expect, it, vi } from "vitest";

import { prepareButterscotchProject } from "./project-store.js";

describe("Butterscotch project store", () => {
  it("streams exact project bytes into OPFS once and reuses them across runtime instances", async () => {
    const directory = new MemoryDirectory();
    const files = [
      { path: "data.win", bytes: Uint8Array.of(1, 2, 3, 4) },
      { path: "included/settings.ini", bytes: Uint8Array.of(5, 6) },
    ];
    const index = JSON.stringify({
      files: files.map(({ path, bytes }) => ({
        path, sizeBytes: bytes.byteLength, url: `https://content.example/${path}`,
      })),
      schemaVersion: 1,
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.endsWith("index.json")) {return new Response(index);}
      const file = files.find(({ path }) => url.endsWith(path));
      return file ? new Response(file.bytes.slice()) : new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const frameWindow = {
      document: { baseURI: "https://host.example/player" },
      navigator: { storage: { getDirectory: async () => directory } },
    } as unknown as Window;
    const progress: Array<{ loadedBytes: number; totalBytes: number | null }> = [];
    const config = {
      sessionId: "launch-1",
      contentDigest: "b".repeat(64),
      adapter: { projectIndexUrl: "https://content.example/index.json" },
    };

    const first = await prepareButterscotchProject(config, frameWindow, (event) => progress.push(event));
    const second = await prepareButterscotchProject({ ...config, sessionId: "launch-2" }, frameWindow, () => undefined);

    expect(first.gamePath).toBe(`/butterscotch/projects/${"b".repeat(64)}/data.win`);
    expect(first.savePath).toBe("/butterscotch/saves/launch-1");
    expect(second.savePath).toBe("/butterscotch/saves/launch-2");
    expect(progress.at(-1)).toEqual({ phase: "PROJECT_CONTENT", loadedBytes: 6, totalBytes: 6 });
    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input)).filter((url) => !url.endsWith("index.json")))
      .toEqual(files.map(({ path }) => `https://content.example/${path}`));
  });
});

class MemoryDirectory {
  private readonly directories = new Map<string, MemoryDirectory>();
  private readonly files = new Map<string, Uint8Array>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) {return existing;}
    if (!options?.create) {throw new DOMException("missing", "NotFoundError");}
    const directory = new MemoryDirectory();
    this.directories.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) {throw new DOMException("missing", "NotFoundError");}
    return {
      createWritable: async () => new MemoryWritable(name, this.files),
      getFile: async () => {
        const stored = this.files.get(name) ?? new Uint8Array();
        const copy = new Uint8Array(stored.byteLength);
        copy.set(stored);
        return new File([copy], name);
      },
    };
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name)) {throw new DOMException("missing", "NotFoundError");}
  }
}

class MemoryWritable {
  private readonly chunks: Uint8Array[] = [];
  constructor(private readonly name: string, private readonly files: Map<string, Uint8Array>) {}
  async write(value: BufferSource | Blob | string) {
    if (!ArrayBuffer.isView(value)) {throw new Error("unexpected write");}
    this.chunks.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice());
  }
  async close() {
    const size = this.chunks.reduce((total, value) => total + value.byteLength, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of this.chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    this.files.set(this.name, bytes);
  }
  async abort() {this.files.delete(this.name);}
}

function requestUrl(input: string | URL | Request) {
  return input instanceof Request ? input.url : String(input);
}
