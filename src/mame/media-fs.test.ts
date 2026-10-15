import {expect, it, vi} from "vitest";
import {mountMameMedia} from "./media-fs.js";

it("presents a large read-only disk through bounded synchronous reads and independent seek positions", () => {
  const readInto = vi.fn((_offset: number, bytes: Uint8Array) => {bytes.fill(7); return bytes.length;});
  const node = {node_ops: {getattr: () => ({size: 0})}, stream_ops: {}};
  const fs = {mkdirTree: vi.fn(), writeFile: vi.fn(), chmod: vi.fn(), lookupPath: () => ({node}),
    ErrnoError: class extends Error {constructor(code: number) {super(String(code));}}, ignorePermissions: true};
  mountMameMedia(fs, "set/disk.chd", 4 * 1024 ** 3, {readInto});
  const ops = node.stream_ops as {read(stream: unknown, buffer: Uint8Array, offset: number, length: number, position: number): number;
    write(): void; llseek(stream: {position: number}, offset: number, whence: number): number};
  expect(node.node_ops.getattr().size).toBe(4 * 1024 ** 3);
  const bytes = new Uint8Array(700000);
  expect(ops.read({}, bytes, 0, bytes.length, 3 * 1024 ** 3)).toBe(bytes.length);
  expect(readInto.mock.calls.every(([, buffer]) => buffer.length <= 256 * 1024)).toBe(true);
  expect(ops.llseek({position: 5}, 7, 1)).toBe(12);
  expect(ops.read({}, bytes, 0, 2, 4 * 1024 ** 3 - 1)).toBe(1);
  expect(() => ops.write()).toThrow();
  expect(() => mountMameMedia(fs, "../outside.chd", 100, {readInto})).toThrow("MAME_CONTENT_INVALID");
  expect(fs.writeFile).toHaveBeenCalledWith("/content/roms/set/disk.chd", new Uint8Array());
});
