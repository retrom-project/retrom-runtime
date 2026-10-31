// @vitest-environment node
import {createHash} from "node:crypto";
import {access, mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, expect, it} from "vitest";
import {runNormalization} from "../scripts/normalization/pipeline.mjs";
import {xmoeResourcePatch} from "../scripts/normalization/xmoe.mjs";
import {normalizeContent} from "../scripts/runtime-normalize-content.mjs";
import {configureRuntime} from "../src/runtime/configure.js";
import {kirikiriPatchLaunches} from "../src/runtime/kirikiri-patches.js";
import type {RuntimeContentFile} from "../src/runtime/types.js";
import {archive, companion, stringsOf} from "./normalization-xmoe-fixture.js";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
async function fixture(nested = true) {
  const root = await mkdtemp(join(tmpdir(), "xmoe-normalization-")); roots.push(root);
  const prefix = nested ? "collection/project/" : "";
  const pe = companion({salt: 73, subtract: 0x61a42193, imageBase: 0x27000000}), pack = archive({salt: 73});
  const sources = {[prefix + "data.xp3"]: Buffer.from("original project"), [prefix + "launch.dll"]: pe.bytes,
    [prefix + pe.profile.archiveName]: pack.bytes};
  const files: RuntimeContentFile[] = [], locators: Record<string, {path: string; offset: number; sizeBytes: number}> = {};
  for (const [key, bytes] of Object.entries(sources)) {
    const path = join(root, String(files.length)); await writeFile(path, Buffer.concat([Buffer.from("BEFORE"), bytes, Buffer.from("AFTER")]));
    files.push({logicalKey: key, name: key, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
    locators[key] = {path, offset: 6, sizeBytes: bytes.length};
  }
  return {root, prefix, files, locators, outputRoot: join(root, "output"), platformId: "kirikiri"};
}
it("exposes converted scripts as an explicit selectable patch without replacing base resources", async () => {
  const input = await fixture(), result = await runNormalization(input, [xmoeResourcePatch]);
  const manifestKey = input.prefix + ".runtime-launches/launch.dll.json";
  const facts = result.files;
  for (const source of input.files) {
    expect(facts.find(file => file.logicalKey === source.logicalKey)).toMatchObject(source);
  }
  const manifest = facts.find(file => file.logicalKey === manifestKey)!;
  const text = await readFile(manifest.path!, "utf8"), evidence = {[manifestKey]: {text}};
  const config = configureRuntime({platformId: "kirikiri", coreIds: ["kirikiri2"], files: facts, evidence});
  expect(config.content).toEqual({kind: "KIRIKIRI_PROJECT", entryFile: input.prefix + "data.xp3"});
  expect(config.cores?.kirikiri2.options?.overlayRoot).toBe(".runtime-patches/launch.dll");
  const options = kirikiriPatchLaunches({files: facts, evidence, configuration: config});
  expect(options.items.map(item => item.id)).toEqual(["original", input.prefix + ".runtime-patches/launch.dll"]);
  expect(options.items[0].configuration.cores).toBeUndefined();
  const script = facts.find(file => file.logicalKey.endsWith("/intro.ks.scn"))!;
  expect(stringsOf(await readFile(script.path!))).toEqual(["caption", "中文对白", "prefix 保留原文 suffix"]);
  expect(result.normalization?.plugins[0].sources).toHaveLength(2);
  expect(result.normalization?.verifiedEntries).toBe(1);
});
it("keeps unrelated files unmatched and explicitly rejects a missing recognized companion archive", async () => {
  const input = await fixture(false);
  const plain = {...input, files: input.files.slice(0, 1)};
  expect(await runNormalization(plain, [xmoeResourcePatch])).toEqual({files: plain.files});
  await expect(runNormalization({...input, files: input.files.slice(0, 2)}, [xmoeResourcePatch]))
    .rejects.toThrow("RUNTIME_XMOE_ARCHIVE_MISSING");
});
it("does not overwrite an existing unowned patch directory", async () => {
  const input = await fixture(false), key = ".runtime-patches/launch.dll/intro.ks.scn";
  const bytes = Buffer.from("unrelated data"), path = join(input.root, "unowned"); await writeFile(path, bytes);
  input.files.push({logicalKey: key, name: key, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
  input.locators[key] = {path, offset: 0, sizeBytes: bytes.length};
  await expect(runNormalization(input, [xmoeResourcePatch])).rejects.toThrow("RUNTIME_NORMALIZATION_CONFLICT");
  expect(await readFile(path)).toEqual(bytes);
});
function move(input: Awaited<ReturnType<typeof fixture>>, from: string, to: string) {
  const file = input.files.find(file => file.logicalKey === from)!;
  file.logicalKey = to; file.name = to; input.locators[to] = input.locators[from]; delete input.locators[from];
}
it("rejects a companion outside the selected project instead of silently disabling its patch", async () => {
  const input = await fixture(), archiveKey = input.files[2].logicalKey;
  move(input, archiveKey, archiveKey.slice(input.prefix.length));
  move(input, input.prefix + "launch.dll", input.prefix + "plugin/launch.dll");
  await expect(runNormalization(input, [xmoeResourcePatch])).rejects.toThrow("RUNTIME_XMOE_ARCHIVE_MISSING");
});
it("binds a nested native module to a signature-detected project entry", async () => {
  const input = await fixture(), key = input.prefix + "data.bundle", bytes = Buffer.from("5850330d0a200a1a8b6701", "hex");
  move(input, input.prefix + "data.xp3", key);
  const file = input.files.find(file => file.logicalKey === key)!;
  await writeFile(input.locators[key].path, bytes);
  file.sizeBytes = bytes.length; file.sha256 = createHash("sha256").update(bytes).digest("hex");
  input.locators[key] = {...input.locators[key], offset: 0, sizeBytes: bytes.length};
  move(input, input.prefix + "launch.dll", input.prefix + "plugin/launch.dll");
  const result = await runNormalization(input, [xmoeResourcePatch]);
  expect(result.files.some(file => file.logicalKey === input.prefix + ".runtime-launches/launch.dll.json")).toBe(true);
});
it("does not take ownership of another valid patch manifest", async () => {
  const input = await fixture(false), overlayRoot = ".runtime-patches/launch.dll";
  const resourceKey = overlayRoot + "/intro.ks.scn", manifestKey = ".runtime-launches/launch.dll.json";
  const resource = Buffer.from("independent patch");
  const resourceFact = {logicalKey: resourceKey, sizeBytes: resource.length, sha256: createHash("sha256").update(resource).digest("hex")};
  const source = input.files[0];
  const manifest = Buffer.from(JSON.stringify({kind: "KIRIKIRI_RESOURCE_PATCH", version: 1, overlayRoot,
    sourceFiles: [{logicalKey: source.logicalKey, sizeBytes: source.sizeBytes, sha256: source.sha256}], resources: [resourceFact]}));
  for (const [key, bytes] of [[resourceKey, resource], [manifestKey, manifest]] as const) {
    const path = join(input.root, String(input.files.length)); await writeFile(path, bytes);
    input.files.push({logicalKey: key, name: key, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
    input.locators[key] = {path, offset: 0, sizeBytes: bytes.length};
  }
  await expect(runNormalization(input, [xmoeResourcePatch])).rejects.toThrow("RUNTIME_NORMALIZATION_CONFLICT");
  expect(await readFile(input.locators[resourceKey].path)).toEqual(resource);
});
it("checks the immutable native module again before conversion", async () => {
  const input = await fixture(false);
  const context = {...input, original: {files: input.files, locators: input.locators}, sourceContentHash: "a".repeat(64), cache: new Map()};
  const plans = await xmoeResourcePatch.probe(context);
  const key = "launch.dll"; await writeFile(input.locators[key].path, Buffer.alloc(input.locators[key].sizeBytes + 12));
  await mkdir(input.outputRoot);
  await expect(xmoeResourcePatch.convert({...context, outputRoot: input.outputRoot, auditRoot: input.root}, plans[0]))
    .rejects.toThrow("RUNTIME_CONTENT_CHANGED");
});
it("runs the registered worker and can normalize the resulting isolated patch again", async () => {
  const input = await fixture(false), first = await normalizeContent(input);
  const locators = {...input.locators};
  for (const file of first.files) {
    if (file.path) {locators[file.logicalKey] = {path: file.path, offset: 0, sizeBytes: file.sizeBytes};}
  }
  const files = first.files.map(({logicalKey, name, sha256, sizeBytes}) => ({logicalKey, name, sha256, sizeBytes}));
  const second = await normalizeContent({...input, files, locators, outputRoot: join(input.root, "again")});
  expect(second.files.map(({logicalKey, sha256, sizeBytes}) => ({logicalKey, sha256, sizeBytes})))
    .toEqual(first.files.map(({logicalKey, sha256, sizeBytes}) => ({logicalKey, sha256, sizeBytes})));
  expect(second.normalization?.details.filter(item => item.code === "CONTAINER_FILE_OVERRIDE")).toHaveLength(2);
});
it("cleans the complete worker output when a matched archive has a corrupt payload", async () => {
  const input = await fixture(false), file = input.files[2], locator = input.locators[file.logicalKey];
  const physical = await readFile(locator.path); physical[locator.offset + 24] ^= 1;
  await writeFile(locator.path, physical);
  file.sha256 = createHash("sha256").update(physical.subarray(locator.offset, locator.offset + file.sizeBytes)).digest("hex");
  await expect(normalizeContent(input)).rejects.toThrow("RUNTIME_XMOE_INVALID");
  await expect(access(input.outputRoot)).rejects.toThrow();
});
