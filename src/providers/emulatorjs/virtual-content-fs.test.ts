import {describe, expect, it} from "vitest";
import {installSeekableContentFS} from "./virtual-content-fs.js";

describe("shared EmulatorJS content FS", () => {
  it("keeps a Daphne pthread read pending until Content I/O fills the shared buffer", async () => {
    const source = new Uint8Array([10, 11, 12, 13, 14, 15]);
    const node = {usedBytes: 0, stream_ops: {}};
    const stream = {node, position: 1};
    const fs = {streams: [null, stream], writeFile(_path: string, data: Uint8Array) {node.usedBytes = data.byteLength;},
      lookupPath() {return {node};}};
    const heap = new Uint8Array(new SharedArrayBuffer(64));
    const view = new DataView(heap.buffer);
    view.setUint32(0, 16, true); view.setUint32(4, 4, true);
    let release: ((bytes: Uint8Array) => void) | undefined;
    let active = 0;
    const file = {filename: "interstellar.m2v", sizeBytes: source.length, canSuspend: true,
      read(position: number, length: number) {
        return new Promise<Uint8Array>(resolve => {release = bytes => resolve(bytes.slice(position, position + length));});
      },
      begin() {active++;}, end() {active--;}, fail(error: Error) {throw error;},
      idle: async () => {}, dispose: async () => {},
    };
    const module = {FS: fs, HEAPU8: heap, retromContentIOAsyncify: () => ({state: 0,
      State: {Normal: 0, Rewinding: 2}, handleSleep: () => 0}),
      retromDaphneFdRead: undefined as ((fd: number, iov: number, iovcnt: number, pnum: number) => Promise<number | null>) | undefined};
    const cleanup = installSeekableContentFS({Module: module}, file, true);
    fs.writeFile("/framefile/interstellar.m2v", new Uint8Array([0]));
    const read = module.retromDaphneFdRead!(1, 0, 1, 8);
    await Promise.resolve(); await Promise.resolve();
    expect(active).toBe(1);
    expect(stream.position).toBe(1);
    release!(source);
    expect(await read).toBe(0);
    expect([...heap.slice(16, 20)]).toEqual([11, 12, 13, 14]);
    expect(view.getUint32(8, true)).toBe(4);
    expect(stream.position).toBe(5);
    expect(active).toBe(0);
    cleanup();
    expect(module.retromDaphneFdRead).toBeUndefined();
  });

  it("serves eager bytes through the FS without Asyncify and restores the original node", () => {
    const originalRead = (_stream: unknown, _buffer: Uint8Array, _offset: number, _length: number, _position: number) => 0;
    const node: {usedBytes: number; contents: Uint8Array; stream_ops: {read: typeof originalRead}} =
      {usedBytes: 0, contents: new Uint8Array(0), stream_ops: {read: originalRead}};
    const fs = {
      writeFile(_path: string, data: Uint8Array) {node.usedBytes = data.byteLength; node.contents = data;},
      lookupPath() {return {node};},
    };
    const originalWrite = fs.writeFile;
    const file = {
      filename: "disc.chd", sizeBytes: 4, canSuspend: false as const, contents: new Uint8Array([1, 2, 3, 4]),
      read(position: number, length: number) {return new Uint8Array([1, 2, 3, 4]).slice(position, position + length);},
      begin() {}, end() {}, fail() {}, idle: async () => {}, dispose: async () => {},
    };
    const cleanup = installSeekableContentFS({Module: {FS: fs}}, file);
    fs.writeFile("/game/disc.chd", new Uint8Array([0]));
    expect(node.usedBytes).toBe(4);
    expect(node.contents).toBe(file.contents);
    const output = new Uint8Array(5);
    expect(node.stream_ops.read?.({}, output, 1, 5, 1)).toBe(3);
    expect([...output]).toEqual([0, 2, 3, 4, 0]);
    cleanup();
    expect(fs.writeFile).toBe(originalWrite);
    expect(node.stream_ops.read).toBe(originalRead);
    expect(node.usedBytes).toBe(1);
    expect([...node.contents]).toEqual([0]);
  });
});
