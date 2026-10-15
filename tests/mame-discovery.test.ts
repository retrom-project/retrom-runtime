// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {zipSync} from "fflate";
import {createHash} from "node:crypto";
import {discoverContentDependencies} from "../scripts/runtime-host-input.mjs";
import {parseCHDHeader} from "../src/runtime/arcade-media.js";
const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const diskSHA1 = "fa49a0bc47f5cb7c30d7e49e2c3696b21bafb840";
function header(sha1 = diskSHA1, version = 5) {
  const layout = ({3: [120, 80], 4: [108, 48], 5: [124, 84]} as Record<number, number[]>)[version];
  const bytes = Buffer.alloc(layout[0]); bytes.write("MComprHD"); bytes.writeUInt32BE(layout[0], 8); bytes.writeUInt32BE(version, 12);
  bytes.writeBigUInt64BE(4096n, version === 5 ? 32 : 28);
  bytes.writeUInt32BE(4096, version === 3 ? 76 : version === 4 ? 44 : 56);
  if (version === 5) {bytes.writeUInt32BE(512, 60); bytes.writeBigUInt64BE(124n, 40);} else {bytes.writeUInt32BE(1, 24);}
  bytes.set(Buffer.from(sha1, "hex"), layout[1]); return bytes;
}
it.each([3, 4, 5])("reads the DAT identity from CHD v%s without confusing raw and combined hashes", version => {
  expect(parseCHDHeader(header(diskSHA1, version), 4096)).toEqual({sha1: diskSHA1, parentSHA1: null});
  expect(() => parseCHDHeader(header(diskSHA1, version).subarray(0, 20), 4096)).toThrow("RUNTIME_ARCADE_DISK_INVALID");
});
it("discovers only identity-matching CHDs from bounded metadata-root facts, irrespective of names", async () => {
  const root = await mkdtemp(join(tmpdir(), "mame-discovery-")); roots.push(root);
  const path = join(root, "game.zip"), bytes = zipSync({}); await writeFile(path, bytes);
  const input = {files: [{name: "shikigam.zip", logicalKey: "shikigam.zip", sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")}], locators: {"shikigam.zip": path},
    directory: {platformId: "arcade", defaultCoreId: "mame_arcade", allowedCoreIds: ["mame_arcade"]}};
  expect(await discoverContentDependencies(input)).toMatchObject({sourceSearch: {extensions: ["chd"], headerBytes: 124}});
  const candidates = [
    {sourcePath: "shikigam/shikigam.chd", sizeBytes: 4096, headerBase64: header("b".repeat(40)).toString("base64")},
    {sourcePath: "other/renamed.chd", sizeBytes: 4096, headerBase64: header().toString("base64")},
  ];
  expect(await discoverContentDependencies({...input, sourceCandidates: candidates})).toEqual({files: [
    {logicalKey: "shikigam/shikigam.chd", sourcePath: "other/renamed.chd", optional: true},
  ]});
  expect(await discoverContentDependencies({...input, sourceCandidates: [candidates[0]]})).toEqual({files: []});
  const differential = header(); differential.fill(1, 104, 124);
  expect(await discoverContentDependencies({...input, sourceCandidates: [candidates[1], {
    ...candidates[0], headerBase64: differential.toString("base64"),
  }]})).toEqual({files: [{logicalKey: "shikigam/shikigam.chd", sourcePath: "other/renamed.chd", optional: true}]});
  await expect(discoverContentDependencies({...input, sourceCandidates: [{...candidates[1], sourcePath: "../outside.chd"}]}))
    .rejects.toThrow("RUNTIME_CONTENT_INVALID");
});

it("rejects impossible geometry and out-of-file offsets without auditing compressed hunks", () => {
  const bytes = header(); bytes.writeUInt32BE(0, 56);
  expect(() => parseCHDHeader(bytes, 4096)).toThrow("RUNTIME_ARCADE_DISK_INVALID");
  const offset = header(); offset.writeBigUInt64BE(4096n, 40);
  expect(() => parseCHDHeader(offset, 4096)).toThrow("RUNTIME_ARCADE_DISK_INVALID");
});
