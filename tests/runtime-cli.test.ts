// @vitest-environment node
import {afterAll, beforeAll, expect, it} from "vitest";
import {build} from "esbuild";
import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {createInterface} from "node:readline";
import {cp, mkdir, mkdtemp, rm, symlink, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {tmpdir} from "node:os";
import {once} from "node:events";
import {createHash} from "node:crypto";
import {zipSync} from "fflate";

let root: string;
const children: ChildProcessWithoutNullStreams[] = [];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "retrom-cli-test-"));
  await mkdir(join(root, "scripts"));
  for (const file of ["runtime-cli.mjs", "runtime-host-input.mjs", "runtime-normalize-content.mjs"]) {
    await cp(resolve("scripts", file), join(root, "scripts", file));
  }
  await cp(resolve("assets/facts"), join(root, "assets/facts"), {recursive: true});
  await writeFile(join(root, "package.json"), JSON.stringify({type: "module", version: "0.0.0-dev"}));
  await symlink(resolve("node_modules"), join(root, "node_modules"));
  await build({entryPoints: [resolve("src/runtime/index.ts")], outfile: join(root, "dist/runtime/index.js"),
    bundle: true, format: "esm", platform: "node", packages: "external"});
});
afterAll(async () => {
  for (const child of children) {if (child.exitCode === null) {child.kill();}}
  await rm(root, {recursive: true, force: true});
});

function worker() {
  const child = spawn(process.execPath, [join(root, "scripts/runtime-cli.mjs"), "--serve"], {cwd: tmpdir()});
  children.push(child);
  const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
  return {child, async read() {const line = await lines.next(); return line.done ? null : JSON.parse(line.value);}};
}
const files = [{logicalKey: "game.nes", name: "game.nes", sha256: "a".repeat(64), sizeBytes: 1}];
const directory = {platformId: "nes", defaultCoreId: "fceumm", allowedCoreIds: ["fceumm"]};

it("reuses a real process for configuration, prepare and identity batches and isolates request failures", async () => {
  const {child, read} = worker();
  child.stdin.write(JSON.stringify({id: "config", command: "configure", input: {platformId: "nes", coreIds: ["fceumm"], files}}) + "\n");
  const configured = await read(); expect(configured.id).toBe("config");
  const input = {directory, config: configured.result, files, fingerprints: {"emulatorjs/fceumm": "b".repeat(64)}};
  child.stdin.write(JSON.stringify({id: 2, command: "prepare", input}) + "\n");
  const prepared = await read(); expect(prepared.result.romHash).toBe(files[0].sha256);
  child.stdin.write("{broken\n" + JSON.stringify({id: 3, command: "missing", input: {}}) + "\n" +
    JSON.stringify({id: 4, command: "batch-identity", input: {items: [input, {...input, config: {}}]}}) + "\n");
  expect((await read()).id).toBe(null);
  expect(await read()).toEqual({id: 3, error: "RUNTIME_COMMAND_INVALID"});
  const identities = await read(); expect(identities.id).toBe(4);
  expect(identities.result[0].romHash).toBe(files[0].sha256); expect(identities.result[1].error).toBeTruthy();
  child.stdin.end(JSON.stringify({id: 5, command: "hash", input: {files, mode: "FILE"}}));
  expect(await read()).toEqual({id: 5, result: {romHash: files[0].sha256}});
  expect(await read()).toBeNull(); expect((await once(child, "close"))[0]).toBe(0);
}, 15000);

it("bounds the stream before a newline and closes an oversized worker", async () => {
  const {child, read} = worker();
  child.stdin.on("error", () => {});
  child.stdin.end(Buffer.alloc(64 * 1024 * 1024 + 1, 32));
  expect(await read()).toEqual({id: null, error: "RUNTIME_REQUEST_TOO_LARGE"});
  expect((await once(child, "close"))[0]).toBe(1);
}, 15000);

it("rejects unsafe request shapes without discarding the next valid request", async () => {
  const {child, read} = worker();
  child.stdin.end([JSON.stringify({id: -1, command: "hash", input: {files}}),
    JSON.stringify({id: "bad", command: "hash", input: {files}, extra: true}),
    JSON.stringify({id: "good", command: "hash", input: {files, mode: "FILE"}})].join("\n") + "\n");
  expect(await read()).toEqual({id: null, error: "RUNTIME_REQUEST_INVALID"});
  expect(await read()).toEqual({id: "bad", error: "RUNTIME_REQUEST_INVALID"});
  expect(await read()).toEqual({id: "good", result: {romHash: files[0].sha256}});
  expect((await once(child, "close"))[0]).toBe(0);
}, 15000);

it("runs source dependency discovery from the independent packaged CLI layout", async () => {
  const {child, read} = worker();
  child.stdin.end(JSON.stringify({id: "dependencies", command: "discover-content", input: {files, locators: {}}}) + "\n");
  expect(await read()).toEqual({id: "dependencies", result: {files: []}});
  expect((await once(child, "close"))[0]).toBe(0);
});

it("projects named Parent requirements and preserves the launch error's actual missing names", async () => {
  const {child, read} = worker();
  const bytes = zipSync({"fixture.bin": Uint8Array.of(1)}), archive = join(root, "1941j.zip");
  await writeFile(archive, bytes);
  const input = {directory: {platformId: "arcade", defaultCoreId: "fbneo", allowedCoreIds: ["fbneo"]},
    config: {content: {kind: "ARCADE", entryFile: "1941j.zip"}}, files: [{logicalKey: "1941j.zip", name: "1941j.zip",
      sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")}],
    locators: {"1941j.zip": archive}, coreId: "fbneo"};
  child.stdin.write(JSON.stringify({id: "parents", command: "arcade-parents", input}) + "\n");
  expect((await read()).result).toMatchObject({coreId: "fbneo", parentFiles: [], missingParents: ["1941.zip"]});
  child.stdin.end(JSON.stringify({id: "launch", command: "prepare",
    input: {...input, fingerprints: {"emulatorjs/fbneo": "b".repeat(64)}}}) + "\n");
  expect(await read()).toEqual({id: "launch", error: "RUNTIME_PARENT_MISSING", errorDetails: {parents: "1941"}});
  expect((await once(child, "close"))[0]).toBe(0);
});

it("projects content BIOS alone from real PSX and arcade evidence without requiring Parent or implementation fingerprints", async () => {
  const {child, read} = worker();
  const disc = Buffer.alloc(5 * 2352); disc.write("Licensed by Sony Computer Entertainment Amer  ica", 4 * 2352 + 32);
  const arcade = zipSync({"unrelated.bin": Uint8Array.of(1)});
  const samples = [{name: "disc.bin", bytes: disc}, {name: "kof99h.zip", bytes: arcade}];
  const metadata = [];
  for (const sample of samples) {
    const path = join(root, sample.name); await writeFile(path, sample.bytes);
    metadata.push({logicalKey: sample.name, name: sample.name, sizeBytes: sample.bytes.length,
      sha256: createHash("sha256").update(sample.bytes).digest("hex")});
  }
  const request = (platformId: string, coreId: string, name: string, sample = files[0]) => ({
    directory: {platformId, defaultCoreId: coreId, allowedCoreIds: [coreId]},
    config: {content: {kind: "SINGLE_FILE", entryFile: name}}, files: [{...sample, logicalKey: name, name}], locators: {},
  });
  const psx = {...request("psx", "mednafen_psx_hw", "disc.bin", metadata[0]), locators: {"disc.bin": join(root, "disc.bin")}};
  const clone = {...request("arcade", "fbneo", "kof99h.zip", metadata[1]),
    config: {content: {kind: "ARCADE", entryFile: "kof99h.zip"}, cores: {fbneo: {parentFiles: ["missing-parent.zip"]}}},
    locators: {"kof99h.zip": join(root, "kof99h.zip")}};
  child.stdin.write(JSON.stringify({id: "bios", command: "batch-content-bios-requirements", input: {items: [
    request("nes", "fceumm", "game.nes"), request("nes", "fceumm", "game.fds"),
    request("atari7800", "prosystem", "game.a78"), psx, clone, {...psx, locators: {"disc.bin": join(root, "does-not-exist")}},
  ]}}) + "\n");
  const result = await read(); expect(result.id).toBe("bios");
  expect(result.result[0]).toEqual({biosRequirements: [], error: null});
  expect(result.result[1]).toMatchObject({error: null, biosRequirements: [expect.objectContaining({logicalName: "disksys.rom", required: true})]});
  expect(result.result[2]).toMatchObject({error: null, biosRequirements: [expect.objectContaining({required: false})]});
  expect(result.result[3]).toMatchObject({error: null, biosRequirements: [expect.objectContaining({condition: "PSX_REGION_US", required: true})]});
  expect(result.result[4]).toMatchObject({error: null, biosRequirements: [expect.objectContaining({logicalName: "neogeo.zip", required: true, members: expect.any(Array)})]});
  expect(result.result[5]).toEqual({biosRequirements: [], error: "RUNTIME_CONTENT_UNAVAILABLE"});
  child.stdin.end(JSON.stringify({id: "limit", command: "batch-content-bios-requirements", input: {items: Array.from({length: 101}, () => ({}))}}) + "\n");
  expect(await read()).toEqual({id: "limit", error: "RUNTIME_REQUEST_TOO_LARGE"});
  expect((await once(child, "close"))[0]).toBe(0);
}, 15000);

it("lists current DOS program paths without validating a stale entry selection or preparing a run", async () => {
  const {child, read} = worker();
  const bytes = zipSync({"folder/Game.EXE": Uint8Array.of(1), "DOS.COM": Uint8Array.of(2),
    "dir/Start.BAT": Uint8Array.of(3), "路径/运行.exe": Uint8Array.of(4), "readme.txt": Uint8Array.of(5)});
  const path = join(root, "programs.dosz"); await writeFile(path, bytes);
  const input = {config: {content: {kind: "DOS_BUNDLE", entryFile: "programs.dosz", entryPath: "removed/OLD.EXE"}},
    files: [{logicalKey: "programs.dosz", name: "programs.dosz", sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")}], locators: {"programs.dosz": path}};
  const entries = ["DOS.COM", "dir/Start.BAT", "folder/Game.EXE", "路径/运行.exe"];
  child.stdin.write(JSON.stringify({id: "programs", command: "dos-entry-candidates", input}) + "\n");
  expect(await read()).toEqual({id: "programs", result: {entries}});
  child.stdin.write(JSON.stringify({id: "stale", command: "dos-entry-candidates", input: {
    ...input, config: {content: {...input.config.content, entryPath: "../invalid-old-entry.exe"}},
  }}) + "\n");
  expect(await read()).toEqual({id: "stale", result: {entries}});
  child.stdin.write(JSON.stringify({id: "missing", command: "dos-entry-candidates", input: {...input, files: files}}) + "\n");
  expect(await read()).toEqual({id: "missing", error: "RUNTIME_ENTRY_MISSING"});
  child.stdin.write(JSON.stringify({id: "unavailable", command: "dos-entry-candidates", input: {
    ...input, locators: {"programs.dosz": join(root, "absent.dosz")},
  }}) + "\n");
  expect(await read()).toEqual({id: "unavailable", error: "RUNTIME_CONTENT_UNAVAILABLE"});
  const unsafe = zipSync({"../escape.exe": Uint8Array.of(1)}); await writeFile(path, unsafe);
  child.stdin.write(JSON.stringify({id: "unsafe", command: "dos-entry-candidates", input: {...input,
    files: [{...input.files[0], sizeBytes: unsafe.length, sha256: createHash("sha256").update(unsafe).digest("hex")}],
  }}) + "\n");
  expect(await read()).toEqual({id: "unsafe", error: "RUNTIME_ARCHIVE_INVALID"});
  const empty = zipSync({"readme.txt": Uint8Array.of(1)}); await writeFile(path, empty);
  child.stdin.end(JSON.stringify({id: "empty", command: "dos-entry-candidates", input: {...input,
    files: [{...input.files[0], sizeBytes: empty.length, sha256: createHash("sha256").update(empty).digest("hex")}],
  }}) + "\n");
  expect(await read()).toEqual({id: "empty", result: {entries: []}});
  expect((await once(child, "close"))[0]).toBe(0);
}, 15000);
