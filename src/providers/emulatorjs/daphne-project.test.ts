// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {zipSync} from "fflate";
import {prepareDaphneProject, prepareDaphneAssets, installDaphneProject} from "./daphne-project.js";
import {registerSeekableContentFS} from "./virtual-content-fs.js";
import type {ContentSessionClient} from "../../content-io/client.js";

afterEach(() => vi.unstubAllGlobals());

describe("Daphne Content I/O project", () => {
  it("loads small members through Content I/O and keeps video seekable", async () => {
    const files = [
      {path: "interstellar.zip", url: "/runtime/content/project/digest/interstellar.zip", sizeBytes: 4},
      {path: "interstellar.txt", url: "/runtime/content/project/digest/interstellar.txt", sizeBytes: 4},
      {path: "interstellar.m2v", url: "/runtime/content/project/digest/interstellar.m2v", sizeBytes: 390_000_000},
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1, files}))));
    const opened: Array<{path: string; transport: string}> = [];
    const session = {
      open: vi.fn(async (source: {identity: {logicalPath: string}; transport: string; sizeBytes: number}) => {
        opened.push({path: source.identity.logicalPath, transport: source.transport});
        return {abi: "content-io-v1", id: source.identity.logicalPath, sizeBytes: source.sizeBytes,
          tryReadInto: (_position: number, buffer: Uint8Array) => {buffer.fill(7); return buffer.byteLength;},
          readInto: vi.fn(), close: vi.fn(async () => {})};
      }),
      materialize: vi.fn(async (_id: string, request: {maxBytes: number}) => ({kind: "BYTES", bytes: new Uint8Array(Math.min(4, request.maxBytes))})),
    } as unknown as ContentSessionClient;
    const project = await prepareDaphneProject({indexUrl: "/runtime/content/project/digest/index.json", contentDigest: "a".repeat(64)},
      session, new AbortController().signal, () => {});
    expect(opened).toEqual([
      {path: "interstellar.zip", transport: "WHOLE_ALLOWED"},
      {path: "interstellar.txt", transport: "WHOLE_ALLOWED"},
      {path: "interstellar.m2v", transport: "RANGE_REQUIRED"},
    ]);
    expect(project.video.sizeBytes).toBe(390_000_000);
    expect(project.files.size).toBe(2);
    await project.video.dispose();
  });

  it("mounts the ROM and framefile while the video node uses a Range reader", () => {
    const nodes = new Map<string, {usedBytes: number; contents: Uint8Array; stream_ops: {
      read?: (stream: unknown, buffer: Uint8Array, offset: number, length: number, position: number) => number}}>();
    const fs = {
      writeFile(path: string, data: Uint8Array) {nodes.set(path, {usedBytes: data.byteLength, contents: data, stream_ops: {}});},
      lookupPath(path: string) {return {node: nodes.get(path)!};},
    };
    const handlers: Record<string, Array<() => void>> = {};
    const instance = {Module: {FS: fs}, fileName: "", downloadRom: async () => {},
      on(event: string, callback: () => void) {(handlers[event] ??= []).push(callback);},
      gameManager: {writeFile(path: string, data: Uint8Array) {fs.writeFile(path, data);}},
    };
    const video = {filename: "interstellar.m2v", sizeBytes: 390_000_000, canSuspend: false,
      read: (_position: number, length: number) => new Uint8Array(length).fill(9),
      begin() {}, end() {}, fail() {}, idle: async () => {}, dispose: async () => {},
    };
    const cleanupFS = registerSeekableContentFS(instance, video, () => {});
    const cleanupProject = installDaphneProject(instance, {romName: "interstellar.zip",
      files: new Map([["interstellar.zip", new Uint8Array([1, 2])], ["interstellar.txt", new Uint8Array([3])]]),
      assets: new Map([["pics/led0.bmp", new Uint8Array([4])]]), video: video as never}, () => {});
    for (const callback of handlers.saveDatabaseLoaded) {callback();}
    expect(nodes.get("/roms/interstellar.zip")?.contents).toEqual(new Uint8Array([1, 2]));
    expect(nodes.get("/framefile/interstellar.txt")?.contents).toEqual(new Uint8Array([3]));
    expect(nodes.get("/pics/led0.bmp")?.contents).toEqual(new Uint8Array([4]));
    const node = nodes.get("/framefile/interstellar.m2v")!;
    expect(node.usedBytes).toBe(390_000_000);
    const output = new Uint8Array(3);
    expect(node.stream_ops.read?.({}, output, 0, 3, 20)).toBe(3);
    expect([...output]).toEqual([9, 9, 9]);
    void instance.downloadRom();
    expect(instance.fileName).toBe("roms/interstellar.zip");
    cleanupProject(); cleanupFS();
  });

  it("accepts only bounded bundled Daphne assets", async () => {
    const files = Object.fromEntries(Array.from({length: 20}, (_, index) =>
      [`pics/led${index}.bmp`, new Uint8Array([index])]));
    const bytes = zipSync(files);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, {headers: {"content-length": String(bytes.length)}})));
    const assets = await prepareDaphneAssets("http://localhost:3000/runtime/providers/emulatorjs/", new AbortController().signal);
    expect(assets.size).toBe(20);
    expect(assets.get("pics/led0.bmp")).toEqual(new Uint8Array([0]));
  });
});
