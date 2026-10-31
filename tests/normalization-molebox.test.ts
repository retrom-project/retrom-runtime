// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {molebox4} from "../scripts/normalization/molebox.mjs";
import {fixture, sourcePE} from "./normalization-molebox-fixture.js";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function request(bytes: Buffer) {
  const root = await mkdtemp(join(tmpdir(), "molebox-normalizer-")); roots.push(root);
  const path = join(root, "source.exe"), outputRoot = join(root, "output"); await writeFile(path, bytes); await mkdir(outputRoot);
  const file = {logicalKey: "nested/launch.exe", name: "launch.exe", sizeBytes: bytes.length, sha256: digest(bytes)};
  const files = [file], locators = {[file.logicalKey]: {path, offset: 0, sizeBytes: bytes.length}};
  return {platformId: "kirikiri", files, locators, original: {files, locators}, auditRoot: root,
    sourceContentHash: "a".repeat(64), cache: new Map(), outputRoot};
}
it.each([false, true])("restores all named files from loader-derived offsets/keys and preserves the executable (relocated=%s)", async relocate => {
  const built = fixture({relocate}), input = await request(built.bytes), plans = await molebox4.probe(input);
  expect(molebox4.phase).toBe("container"); expect(plans).toHaveLength(1);
  expect(plans[0].outputs).toEqual(["nested/launch.exe", "nested/resources/boot.ks", "nested/resources/large.bin", "nested/resources/notes.txt"]);
  const result = await molebox4.convert(input, plans[0]);
  for (const resource of built.resources) expect(await readFile(join(input.outputRoot, "nested/resources", resource.name))).toEqual(resource.bytes);
  expect(await readFile(join(input.outputRoot, "nested/launch.exe"))).toEqual(built.bytes);
  expect(result.files).toHaveLength(4); expect(result.summary?.verifiedEntries).toBe(3);
});
it("does not claim an unrelated PE/overlay", async () => {
  const input = await request(Buffer.concat([sourcePE({}).bytes.subarray(0, 128), Buffer.alloc(1024)]));
  expect(await molebox4.probe(input)).toEqual([]);
});
it("leaves an ordinary large PE image unmatched before applying container allocation limits", async () => {
  const end = 33 * 1024 * 1024, bytes = Buffer.alloc(end + 8);
  sourcePE({}).bytes.subarray(0, 512).copy(bytes);
  bytes.writeUInt32LE(end - 0x1200, 0x178 + 40 + 8); bytes.writeUInt32LE(end - 0x1200, 0x178 + 40 + 16);
  expect(await molebox4.probe(await request(bytes))).toEqual([]);
});
it.each([["badCatalog", "RUNTIME_MOLEBOX_INVALID"], ["hidden", "RUNTIME_MOLEBOX_UNSUPPORTED"], ["invalidName", "RUNTIME_MOLEBOX_PATH_INVALID"],
  ["injected", "RUNTIME_MOLEBOX_INJECTION_UNSUPPORTED"], ["cycle", "RUNTIME_MOLEBOX_INVALID"], ["duplicate", "RUNTIME_MOLEBOX_INVALID"],
  ["externalMount", "RUNTIME_MOLEBOX_UNSUPPORTED"]] as const)("fails closed for recognized %s", async (property, error) => {
  await expect(molebox4.probe(await request(fixture({[property]: true}).bytes))).rejects.toThrow(error);
});
it("rejects a stage expansion before allocating its declared oversized result", async () => {
  await expect(molebox4.probe(await request(fixture({expandedStage: 128 * 1024 * 1024}).bytes))).rejects.toThrow("RUNTIME_MOLEBOX_LIMIT");
});
it("validates every output block instead of accepting correct directory CRCs alone", async () => {
  const built = fixture(); built.bytes[built.corruptBlockAt + 2] ^= 3;
  const input = await request(built.bytes), [plan] = await molebox4.probe(input);
  await expect(molebox4.convert(input, plan)).rejects.toThrow("RUNTIME_MOLEBOX_INVALID");
});
it("uses container metadata to explicitly declare the same-path native module override", async () => {
  const input = await request(fixture().bytes), key = "nested/resources/boot.ks";
  input.files.push({logicalKey: key, name: "boot.ks", sizeBytes: 3, sha256: "b".repeat(64)});
  const [plan] = await molebox4.probe(input);
  expect(plan.claims).toEqual(["nested/launch.exe"]); expect(plan.overrides).toEqual([key]);
});
it("honors cancellation before reading or emitting a container", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(molebox4.probe({...await request(fixture().bytes), signal: controller.signal})).rejects.toThrow();
});
it("associates each embedded mount with its ordinal seed and gives later packages native precedence", async () => {
  const input = await request(fixture({multiplePackages: true}).bytes), [plan] = await molebox4.probe(input);
  const result = await molebox4.convert(input, plan);
  expect(await readFile(join(input.outputRoot, "nested/resources/boot.ks"), "utf8")).toBe("later package wins");
  expect(await readFile(join(input.outputRoot, "nested/resources/notes.txt"), "utf8")).toBe("plain text");
  expect(result.files).toHaveLength(4);
});
it("reads an immutable logical PE slice instead of the surrounding host file", async () => {
  const built = fixture(), input = await request(built.bytes), locator = input.locators[input.files[0].logicalKey];
  await writeFile(locator.path, Buffer.concat([Buffer.alloc(79, 1), built.bytes, Buffer.alloc(333, 2)])); locator.offset = 79;
  const [plan] = await molebox4.probe(input); await molebox4.convert(input, plan);
  expect(await readFile(join(input.outputRoot, "nested/launch.exe"))).toEqual(built.bytes);
});
it("fails if the source changes after planning instead of decoding stale packet offsets", async () => {
  const input = await request(fixture().bytes), [plan] = await molebox4.probe(input), locator = input.locators[input.files[0].logicalKey];
  const bytes = await readFile(locator.path); bytes[bytes.length - 1] ^= 1; await writeFile(locator.path, bytes);
  await expect(molebox4.convert(input, plan)).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
});

