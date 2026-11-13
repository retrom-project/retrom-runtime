import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {TextEncoder} from "node:util";

// The codec lives with the standalone module Worker, which registers one listener.
globalThis.self = {addEventListener() {}};
const {encodeNativeSave, decodeNativeSave, readNativeSave, importNativeSave} =
  await import("../assets/runtime/butterscotch/worker.mjs");
delete globalThis.self;

const fs = {
  mkdirTree: path => mkdirSync(path, {recursive: true}), readdir: readdirSync, lstat: lstatSync,
  readFile: path => new Uint8Array(readFileSync(path)), writeFile: writeFileSync,
};

test("native files round trip across independent session directories, including binary and empty files", () => {
  const root = mkdtempSync(join(tmpdir(), "butterscotch-save-"));
  try {
    const source = join(root, "launch-one"), target = join(root, "launch-two");
    fs.mkdirTree(source);
    assert.equal(readNativeSave(fs, source), null);
    const files = [["profile/槽位.bin", Uint8Array.of(0, 255, 1, 128)], ["empty", new Uint8Array()],
      ["settings.ini", new TextEncoder().encode("sound=1\n")], ["\ufeffslot", Uint8Array.of(7, 8)]];
    importNativeSave(fs, source, encodeNativeSave(files));
    const captured = readNativeSave(fs, source);
    importNativeSave(fs, target, captured);
    assert.deepEqual(readNativeSave(fs, target), captured);
    assert.deepEqual(decodeNativeSave(captured), [...files].sort(([a], [b]) => a < b ? -1 : 1));
    writeFileSync(join(source, "settings.ini"), "sound=0\n");
    assert.notDeepEqual(readNativeSave(fs, source), captured);
    assert.deepEqual(readNativeSave(fs, target), captured);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test("validates the entire bounded archive before writing, including conflicts, truncation and paths", () => {
  const bytes = encodeNativeSave([["save", Uint8Array.of(9, 8, 7)]]);
  for (let size = 0; size < bytes.length; size++) {
    const writes = [];
    assert.throws(() => importNativeSave({mkdirTree: () => writes.push("mkdir")}, "/save", bytes.slice(0, size)));
    assert.deepEqual(writes, []);
  }
  assert.throws(() => decodeNativeSave(new Uint8Array([...bytes, 0])));
  for (const path of ["../save", "/save", "a/../save", "a\\save", "a//b", "a:", "a\0b", "a/./b"]) {
    assert.throws(() => encodeNativeSave([[path, Uint8Array.of(1)]]));
  }
  for (const names of [["a", "a"], ["a", "a-", "a/x"]]) {
    assert.throws(() => encodeNativeSave(names.map(name => [name, Uint8Array.of(1)])));
  }
  assert.throws(() => encodeNativeSave([["save", new Uint8Array(16 * 1024 * 1024)]]));
  assert.throws(() => encodeNativeSave(Array.from({length: 4097}, (_, i) => [String(i), new Uint8Array()])));
  const traversal = bytes.slice(); traversal.set(new TextEncoder().encode("../x"), 20);
  assert.throws(() => decodeNativeSave(traversal));
});

test("refuses symlinks and checks file sizes before reading oversized native files", () => {
  let read = false;
  assert.throws(() => readNativeSave({...fs, readdir: () => ["large"],
    lstat: () => ({mode: 0o100644, size: 16 * 1024 * 1024}), readFile: () => {read = true;}}, "/save"));
  assert.equal(read, false);
  const root = mkdtempSync(join(tmpdir(), "butterscotch-link-"));
  try {
    writeFileSync(join(root, "real"), "data"); symlinkSync("real", join(root, "link"));
    assert.throws(() => readNativeSave(fs, root));
  } finally {rmSync(root, {recursive: true, force: true});}
});
