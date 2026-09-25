import {describe, expect, it} from "vitest";
import {installSeekableContentFS} from "./virtual-content-fs.js";

describe("shared EmulatorJS content FS", () => {
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
