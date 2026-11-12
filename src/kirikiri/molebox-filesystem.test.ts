// @vitest-environment node
import {createHash} from "node:crypto";
import {expect, it, vi} from "vitest";
import {installMoleboxFilesystem, moleboxNameHash, type MoleboxFilesystem} from "./molebox-filesystem.js";

const nativeHash = (name: string) => createHash("md5").update(Buffer.from(name, "utf16le")).digest("hex");
function fixture() {
  const privateRoot = "root/.retrom-molebox/" + "a".repeat(64) + "/";
  const hash = nativeHash("RESOURCES\\秘密.BIN"), backing = privateRoot + hash + ".bin";
  const index = {kind: "molebox4-steelbox", source: "root/app.exe", directories: ["resources"],
    entries: [{hash, flags: 7, path: backing}]};
  const opened: string[] = [], directories = new Set(["/", "/root"]), paths = new Map([
    ["/root/app.exe", 10], ["/root/visible.txt", 3], ["/" + backing, 37], ["/" + privateRoot + "index.json", 300],
  ]);
  const fs: MoleboxFilesystem = {
    has: path => paths.has(path) ? 1 : directories.has(path) ? 2 : 0,
    stat: path => paths.has(path) ? {size: paths.get(path)!, isDir: false} : null,
    resolveCase: path => paths.has(path) ? path : null,
    open: path => {opened.push(path); return paths.has(path) ? 4 : -1;},
    listdir: () => [{name: "visible.txt", size: 3, isDir: false}, {name: ".retrom-molebox", size: 0, isDir: true}],
    unlink: path => paths.delete(path) ? 0 : -1,
    mkdir: path => {directories.add(path); return 0;},
  };
  const readInto = vi.fn(async (_offset: number, output: Uint8Array) => {
    output.set(new TextEncoder().encode(JSON.stringify(index))); return output.length;
  });
  const files = [index.source, backing, privateRoot + "index.json"].map(path => ({path,
    reader: {sizeBytes: path.endsWith("index.json") ? new TextEncoder().encode(JSON.stringify(index)).length : 37, readInto}}));
  return {fs, files, index, backing, privateRoot, opened, directories, readInto};
}
it("resolves a hidden UTF-16 native query, keeps the logical placed path and leaves enumeration hidden", async () => {
  const f = fixture();
  expect(f.fs.has("/root/resources/秘密.bin")).toBe(0);
  await installMoleboxFilesystem(f.fs, f.files);
  expect(f.readInto).toHaveBeenCalledTimes(1);
  expect(f.fs.has("/root/ReSoUrCeS/秘密.bin")).toBe(1);
  expect(f.fs.stat("/root/resources/秘密.bin")).toEqual({size: 37, isDir: false});
  expect(f.fs.resolveCase("/root/resources/秘密.bin")).toBe("/root/resources/秘密.bin");
  expect(f.fs.open("/root/resources/秘密.bin", 0)).toBe(4);
  expect(f.opened).toEqual(["/" + f.backing]);
  expect(f.fs.listdir("/root")).toEqual([{name: "visible.txt", size: 3, isDir: false}]);
  expect(f.fs.has("/" + f.backing)).toBe(0);
  expect(f.fs.open("/" + f.backing, 0)).toBe(-1);
  expect(f.fs.has("/elsewhere/resources/秘密.bin")).toBe(0);
  expect(f.fs.open("/root/resources/秘密.bin", 1)).toBe(-1);
  expect(f.fs.unlink("/root/resources/秘密.bin")).toBe(-1);
  expect(f.fs.has("/root/visible.txt")).toBe(1);
  expect(f.directories.has("/root/resources")).toBe(true);
});
it("matches native alias and UTF-16-unit hashing without Unicode expansions", () => {
  expect(moleboxNameHash("<>.exe")).toBe("3d43e6e6e9dced5d5aac3f7ab770b79a");
  expect(moleboxNameHash("resources/秘密.bin")).toBe(nativeHash("RESOURCES\\秘密.BIN"));
  expect(moleboxNameHash("ß.bin")).toBe(nativeHash("ß.BIN"));
  expect(moleboxNameHash("😀.bin")).toBe(nativeHash("😀.BIN"));
});
it("does not read ordinary resources or alter a project without a namespace descriptor", async () => {
  const f = fixture(), has = f.fs.has;
  await installMoleboxFilesystem(f.fs, f.files.filter(file => !file.path.endsWith("index.json")));
  expect(f.fs.has).toBe(has); expect(f.readInto).not.toHaveBeenCalled();
});
it.each(["foreign-backing", "duplicate-hash", "fallback", "out-of-range-flags", "bad-source"])("rejects %s before installing partial state", async mode => {
  const f = fixture(), has = f.fs.has;
  if (mode === "foreign-backing") f.index.entries[0].path = "elsewhere/data.bin";
  if (mode === "duplicate-hash") f.index.entries.push({...f.index.entries[0]});
  if (mode === "fallback") f.index.entries[0].flags = 0x20;
  if (mode === "out-of-range-flags") f.index.entries[0].flags = 0x100000007;
  if (mode === "bad-source") f.index.source = "../escape.exe";
  f.files.at(-1)!.reader.sizeBytes = new TextEncoder().encode(JSON.stringify(f.index)).length;
  await expect(installMoleboxFilesystem(f.fs, f.files)).rejects.toThrow("KIRIKIRI_MOLEBOX_INDEX_INVALID");
  expect(f.fs.has).toBe(has);
});
it("honors cancellation before metadata reads and does not install a namespace", async () => {
  const f = fixture(), has = f.fs.has, controller = new AbortController(); controller.abort();
  await expect(installMoleboxFilesystem(f.fs, f.files, controller.signal)).rejects.toThrow();
  expect(f.readInto).not.toHaveBeenCalled(); expect(f.fs.has).toBe(has);
});
