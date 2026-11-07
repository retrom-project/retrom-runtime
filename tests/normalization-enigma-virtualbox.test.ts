// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {mkdtemp, mkdir, writeFile, readFile, rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runNormalization} from "../scripts/normalization/pipeline.mjs";
import {normalizers} from "../scripts/normalization/registry.mjs";
import {virtualBoxExecutable, virtualBoxPackage, type VirtualFile} from "./normalization-enigma-virtualbox-fixture.js";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
type Request = Awaited<ReturnType<typeof input>>;
async function input(members: Record<string, Buffer>) {
  const root = await mkdtemp(join(tmpdir(), "evb-normalization-")); roots.push(root);
  const outputRoot = join(root, "output"); await mkdir(outputRoot);
  const files: {logicalKey: string; name: string; sha256: string; sizeBytes: number}[] = [];
  const locators: Record<string, {path: string; offset: number; sizeBytes: number}> = {};
  let n = 0;
  for (const [logicalKey, bytes] of Object.entries(members)) {
    const path = join(root, "source-" + n++); await writeFile(path, bytes);
    files.push({logicalKey, name: logicalKey.split("/").at(-1)!, sha256: sha(bytes), sizeBytes: bytes.length});
    locators[logicalKey] = {path, offset: 0, sizeBytes: bytes.length};
  }
  return {platformId: "kirikiri", files, locators, outputRoot};
}
const read = (request: Request, key: string) => readFile(join(request.outputRoot, key));
const story = Buffer.from("translated scenario"), font = Buffer.alloc(70000, 7);
const files: VirtualFile[] = [{path: "data/startup.tjs", data: Buffer.from("startup")}, {path: "data/scenario/a.ks", data: story},
  {path: "ui_font/f.ttf", data: font}];

it("materializes an explicitly configured external layout-3 package beside the executable", async () => {
  const exe = virtualBoxExecutable(["pack_*.dat", "missing.dat"], virtualBoxPackage([])).bytes;
  const request = await input({"game/run.exe": exe, "game/pack_a.dat": virtualBoxPackage(files), "game/data.xp3": Buffer.from("xp3"),
    "other/pack_b.dat": virtualBoxPackage([{path: "data/x.ks", data: Buffer.from("x")}])});
  const result = await runNormalization(request, normalizers);
  const keys = result.files.map(file => file.logicalKey);
  expect(keys).toEqual(expect.arrayContaining(["game/data/startup.tjs", "game/data/scenario/a.ks", "game/ui_font/f.ttf",
    "game/run.exe", "game/pack_a.dat", "game/data.xp3", "other/pack_b.dat"]));
  expect(keys).not.toContain("game/data/x.ks");
  expect(await read(request, "game/data/scenario/a.ks")).toEqual(story);
  expect(await read(request, "game/ui_font/f.ttf")).toEqual(font);
  expect(await read(request, "game/run.exe")).toEqual(exe);
});

it("keeps the newest package first and the first same-name record inside a package", async () => {
  const exe = virtualBoxExecutable(["*.dat"], virtualBoxPackage([{path: "data/a.ks", data: Buffer.from("internal")}], {timestamp: 1})).bytes;
  const older = virtualBoxPackage([{path: "data/a.ks", data: Buffer.from("older")}, {path: "data/b.ks", data: Buffer.from("older b")}], {timestamp: 2});
  const newer = virtualBoxPackage([{path: "data/a.ks", data: Buffer.from("newer")}, {path: "DATA/A.KS", data: Buffer.from("dup")}], {timestamp: 3});
  const request = await input({"run.exe": exe, "a.dat": older, "b.dat": newer});
  await runNormalization(request, normalizers);
  expect(await read(request, "data/a.ks")).toEqual(Buffer.from("newer"));
  expect(await read(request, "data/b.ks")).toEqual(Buffer.from("older b"));
});

it("declares replacement of physical files with the same virtual path", async () => {
  const exe = virtualBoxExecutable(["p.dat"], virtualBoxPackage([])).bytes, old = Buffer.from("old");
  const request = await input({"run.exe": exe, "p.dat": virtualBoxPackage(files), "data/startup.tjs": old});
  const result = await runNormalization(request, normalizers);
  expect(await read(request, "data/startup.tjs")).toEqual(Buffer.from("startup"));
  expect(result.normalization?.details).toContainEqual(expect.objectContaining({code: "CONTAINER_FILE_OVERRIDE", member: "data/startup.tjs", sourceSha256: sha(old)}));
});

it("leaves executables without the connected loader and non-package mask matches unchanged", async () => {
  const disconnected = virtualBoxExecutable(["p.dat"], virtualBoxPackage([]), {disconnect: true}).bytes;
  const request = await input({"run.exe": disconnected, "p.dat": virtualBoxPackage(files)});
  const result = await runNormalization(request, normalizers);
  expect(result.files.map(file => file.logicalKey).sort()).toEqual(["p.dat", "run.exe"]);
  const plain = await input({"run.exe": virtualBoxExecutable(["p.dat"], virtualBoxPackage([])).bytes, "p.dat": Buffer.from("not a package")});
  expect((await runNormalization(plain, normalizers)).files.map(file => file.logicalKey).sort()).toEqual(["p.dat", "run.exe"]);
});

it.each([
  ["compressed record", {files: [{path: "a.ks", data: Buffer.from("x"), flags: 1}]}, "RUNTIME_ENIGMA_UNSUPPORTED"],
  ["redirect target", {files: [{path: "a.ks", data: Buffer.from("x"), target: "C:\\x"}]}, "RUNTIME_ENIGMA_UNSUPPORTED"],
  ["other layout", {files, layout: 2}, "RUNTIME_ENIGMA_UNSUPPORTED"],
  ["other virtual root", {files, root: "%SYSTEM%"}, "RUNTIME_ENIGMA_UNSUPPORTED"],
  ["escaping path", {files: [{path: "../escape", data: Buffer.from("x")}]}, "RUNTIME_ENIGMA_PATH_INVALID"],
])("rejects a matched package with %s", async (_, options, code) => {
  const {files: members, ...rest} = options as {files: VirtualFile[]; layout?: number; root?: string};
  const request = await input({"run.exe": virtualBoxExecutable(["p.dat"], virtualBoxPackage([])).bytes, "p.dat": virtualBoxPackage(members, rest)});
  await expect(runNormalization(request, normalizers)).rejects.toThrow(code);
});

it("rejects truncated or trailing metadata and payload ranges outside the filesystem", async () => {
  const pack = virtualBoxPackage(files), exe = virtualBoxExecutable(["p.dat"], virtualBoxPackage([])).bytes;
  const trailing = Buffer.from(pack); trailing.writeUInt32LE(trailing.readUInt32LE(64) + 1, 64);
  await expect(runNormalization(await input({"run.exe": exe, "p.dat": trailing}), normalizers)).rejects.toThrow(/RUNTIME_ENIGMA_/);
  const truncated = Buffer.from(pack); truncated.writeBigUInt64LE(truncated.readBigUInt64LE(32) - 1n, 32);
  await expect(runNormalization(await input({"run.exe": exe, "p.dat": truncated}), normalizers)).rejects.toThrow(/RUNTIME_ENIGMA_/);
});

it("rejects an unsupported configuration prefix after the loader is recognized", async () => {
  const exe = virtualBoxExecutable(["p.dat"], virtualBoxPackage([]), {prefix: "%APPDATA%\\"}).bytes;
  await expect(runNormalization(await input({"run.exe": exe, "p.dat": virtualBoxPackage(files)}), normalizers)).rejects.toThrow("RUNTIME_ENIGMA_UNSUPPORTED");
});
