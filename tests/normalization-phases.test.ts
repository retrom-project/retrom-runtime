// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {runNormalization, type Normalizer, type NormalizationContext} from "../scripts/normalization/pipeline.mjs";
import {contentStream} from "../scripts/runtime-host-content.mjs";
import type {HostContentLocator} from "../scripts/runtime-host-content.mjs";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture(entries: Record<string, string> = {"game/launcher.exe": "container", "game/readme.txt": "keep"}) {
  const root = await mkdtemp(join(tmpdir(), "normalization-phases-")); roots.push(root);
  const files = [], locators: Record<string, HostContentLocator> = {};
  for (const [logicalKey, value] of Object.entries(entries)) {
    const bytes = Buffer.from(value), path = join(root, "source", logicalKey); await mkdir(dirname(path), {recursive: true});
    // Reception locators can refer to a member inside an immutable STORE object.
    await writeFile(path, Buffer.concat([Buffer.from("prefix"), bytes, Buffer.from("suffix")]));
    files.push({logicalKey, name: logicalKey, sizeBytes: bytes.length, sha256: sha(bytes)});
    locators[logicalKey] = {path, offset: 6, sizeBytes: bytes.length};
  }
  const outputRoot = join(root, "output"); await mkdir(outputRoot);
  return {platformId: "test", files, locators, outputRoot};
}
async function bytes(context: {locators?: Record<string, HostContentLocator>}, key: string) {
  const chunks = [];
  for await (const chunk of contentStream(context.locators![key])) {chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function emit(root: string, entries: Record<string, Buffer>) {
  return Promise.all(Object.entries(entries).map(async ([logicalKey, value]) => {
    const path = join(root, logicalKey); await mkdir(dirname(path), {recursive: true}); await writeFile(path, value, {flag: "wx"});
    return {logicalKey, name: logicalKey, sizeBytes: value.length, sha256: sha(value), path};
  }));
}
function container(extra: Record<string, Buffer> = {"game/data.xp3": Buffer.from("encrypted")}, overrides: string[] = []): Normalizer {
  return {id: "container", phase: "container", version: 1, priority: 200, platforms: ["test"], formats: ["test-container"],
    async probe() {return [{format: "test-container", claims: ["game/launcher.exe"],
      outputs: ["game/launcher.exe", ...Object.keys(extra)], overrides, launchDomain: "game/launcher.exe"}];},
    async convert(context) {return {files: await emit(context.outputRoot, {"game/launcher.exe": await bytes(context, "game/launcher.exe"), ...extra})};}};
}
function resource(onProbe?: (context: NormalizationContext) => Promise<void>): Normalizer {
  return {id: "resource", phase: "resource", version: 1, priority: 1, platforms: ["test"], formats: ["test-resource"],
    async probe(context) {
      await onProbe?.(context);
      return context.files.some(file => file.logicalKey === "game/data.xp3") ?
        [{format: "test-resource", claims: ["game/data.xp3"], outputs: ["game/data.xp3"]}] : [];
    },
    async convert(context) {
      expect((await bytes(context, "game/data.xp3")).toString()).toBe("encrypted");
      return {files: await emit(context.outputRoot, {"game/data.xp3": Buffer.from("standard XP3")})};
    }};
}
it("expands containers before resource probing, isolates rewrites, and publishes only final flat paths", async () => {
  const input = await fixture(), expanded = container(), normalized = resource(), directories: string[] = [];
  for (const plugin of [expanded, normalized]) {
    const convert = plugin.convert;
    plugin.convert = async (context, plan) => {directories.push(context.outputRoot); return convert(context, plan);};
  }
  const result = await runNormalization(input, [normalized, expanded]);
  const output = result.files.find(file => file.logicalKey === "game/data.xp3")!;
  expect(output.path).toBe(join(input.outputRoot, output.logicalKey));
  expect((await readFile(output.path!)).toString()).toBe("standard XP3");
  expect(new Set(directories).size).toBe(2);
  expect(result.normalization?.plugins.map(item => item.id)).toEqual(["container", "resource"]);
  expect(result.files.find(file => file.logicalKey === "game/readme.txt")).toEqual(input.files[1]);
  expect(await readdir(dirname(input.outputRoot))).toEqual(["output", "source"]);
});
it("records declared overlays and retains original locators for independent filter discovery", async () => {
  const input = await fixture({"game/launcher.exe": "container", "game/plugin/filter.tpm": "original filter"});
  const expanded = container({"game/data.xp3": Buffer.from("encrypted"), "game/plugin/filter.tpm": Buffer.from("replacement filter")}, ["game/plugin/filter.tpm"]);
  const result = await runNormalization(input, [resource(async context => {
    expect((await bytes(context, "game/plugin/filter.tpm")).toString()).toBe("replacement filter");
    expect((await bytes(context.original, "game/plugin/filter.tpm")).toString()).toBe("original filter");
  }), expanded]);
  expect(result.normalization?.plugins[0].sources.map(file => file.file)).toEqual(["game/launcher.exe", "game/plugin/filter.tpm"]);
  expect(result.normalization?.details).toContainEqual({code: "CONTAINER_FILE_OVERRIDE", file: "game/launcher.exe", member: "game/plugin/filter.tpm",
    sourceSha256: sha(Buffer.from("original filter")), outputSha256: sha(Buffer.from("replacement filter")), sourceSize: 15, outputSize: 18});
  expect((await bytes(input, "game/plugin/filter.tpm")).toString()).toBe("original filter");
});
it("rejects undeclared overlays and independent launch domains before writing any files", async () => {
  const input = await fixture(), expanded = container({"game/readme.txt": Buffer.from("replacement")}), convert = vi.spyOn(expanded, "convert");
  await expect(runNormalization(input, [expanded])).rejects.toThrow("RUNTIME_NORMALIZATION_CONFLICT");
  const first = container(), other = {...container(), id: "other", async probe() {
    return [{format: "test-container", claims: ["game/readme.txt"], outputs: ["other/data.xp3"], launchDomain: "game/readme.txt"}];
  }};
  const firstConvert = vi.spyOn(first, "convert");
  await expect(runNormalization(input, [first, other])).rejects.toThrow("RUNTIME_NORMALIZATION_LAUNCH_AMBIGUOUS");
  expect(convert).not.toHaveBeenCalled(); expect(firstConvert).not.toHaveBeenCalled();
});
it("requires overlays to name existing inputs and their replacement outputs, only in container plans", async () => {
  const input = await fixture();
  for (const overrides of [["missing"], ["game/readme.txt"], ["game/launcher.exe"]]) {
    await expect(runNormalization(input, [container(undefined, overrides)])).rejects.toThrow("RUNTIME_NORMALIZATION_PLAN_INVALID");
  }
  const invalid = resource(); invalid.probe = async () => [{format: "test-resource", claims: ["game/launcher.exe"], outputs: ["game/readme.txt"], overrides: ["game/readme.txt"]}];
  await expect(runNormalization(input, [invalid])).rejects.toThrow("RUNTIME_NORMALIZATION_PLAN_INVALID");
});
it("does not publish first-stage outputs when resource conversion fails or cancellation arrives", async () => {
  const input = await fixture(), fail = resource(); fail.convert = async () => {throw new Error("RUNTIME_TEST_CORRUPT_RESOURCE");};
  await expect(runNormalization(input, [container(), fail])).rejects.toThrow("RUNTIME_TEST_CORRUPT_RESOURCE");
  expect(await readdir(input.outputRoot)).toEqual([]);
  const controller = new AbortController(), cancel = container(), convert = cancel.convert;
  cancel.convert = async (context, plan) => {const result = await convert(context, plan); controller.abort(new Error("cancelled")); return result;};
  await expect(runNormalization(input, [cancel, resource()], controller.signal)).rejects.toThrow("cancelled");
  expect(await readdir(dirname(input.outputRoot))).toEqual(["output", "source"]);
  expect(await readdir(input.outputRoot)).toEqual([]);
});
it("keeps two-stage content and audit deterministic across input order and plugin versions", async () => {
  const input = await fixture(), expanded = container(), normalized = resource();
  const first = await runNormalization(input, [normalized, expanded]);
  const outputRoot = input.outputRoot + "-second"; await mkdir(outputRoot); expanded.version = 2;
  const second = await runNormalization({...input, files: [...input.files].reverse(), outputRoot}, [expanded, normalized]);
  const facts = (result: typeof first) => result.files.map(({logicalKey, sizeBytes, sha256}) => ({logicalKey, sizeBytes, sha256}));
  expect(facts(second)).toEqual(facts(first));
  expect(second.normalization?.sourceContentHash).toBe(first.normalization?.sourceContentHash);
  expect(second.normalization?.plugins[0]).toEqual({...first.normalization?.plugins[0], version: 2});
});
it("does not strand a private workspace when source facts fail identity validation", async () => {
  const input = await fixture(); input.files[0].sha256 = "invalid";
  await expect(runNormalization(input, [container(), resource()])).rejects.toThrow("RUNTIME_CONTENT_INVALID");
  expect(await readdir(dirname(input.outputRoot))).toEqual(["output", "source"]);
});
