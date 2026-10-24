// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {planNormalization, runNormalization, type Normalizer, type NormalizationPlan} from "../scripts/normalization/pipeline.mjs";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
async function input() {
  const root = await mkdtemp(join(tmpdir(), "normalizer-registry-")); roots.push(root);
  const files = ["data.xp3", "patch.xp3", "readme.txt"].map(name => ({logicalKey: name, name, sizeBytes: 1, sha256: "a".repeat(64)}));
  const outputRoot = join(root, "output"); await mkdir(outputRoot);
  return {platformId: "test", files, outputRoot};
}
function plugin(id: string, claims: string[], priority = 100): Normalizer {
  return {id, version: 1, priority, platforms: ["test"], formats: ["synthetic"],
    async probe() {return claims.length ? [{format: "synthetic", claims, outputs: claims}] : [];},
    async convert(context, plan) {
      const files = [];
      for (const logicalKey of plan.outputs) {
        const bytes = Buffer.from(`${id}:${logicalKey}`), path = join(context.outputRoot, logicalKey);
        await writeFile(path, bytes, {flag: "wx"});
        files.push({logicalKey, name: logicalKey, path, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
      }
      return {files};
    }};
}
it("probes every plugin in deterministic priority/id order before conversion, retaining unclaimed files", async () => {
  const request = await input(), events: string[] = [], a = plugin("a", ["data.xp3"]), b = plugin("b", ["patch.xp3"]), c = plugin("c", [], 50);
  for (const item of [a, b, c]) {
    const probe = item.probe, convert = item.convert;
    item.probe = async context => {events.push(`probe:${item.id}`); return probe(context);};
    item.convert = async (context, plan) => {events.push(`convert:${item.id}`); return convert(context, plan);};
  }
  const result = await runNormalization(request, [b, a, c]);
  expect(events).toEqual(["probe:c", "probe:a", "probe:b", "convert:a", "convert:b"]);
  expect(result.files.find(file => file.logicalKey === "readme.txt")).toEqual(request.files[2]);
  expect(result.normalization?.plugins.map(item => [item.id, item.version, item.validation.outputFilesVerified])).toEqual([["a", 1, 1], ["b", 1, 1]]);
});
it("all-unmatched plans return the original facts and never invoke convert", async () => {
  const request = await input(), a = plugin("a", []), convert = vi.spyOn(a, "convert");
  expect(await runNormalization(request, [a])).toEqual({files: request.files});
  expect(convert).not.toHaveBeenCalled();
});
it("rejects overlapping claims before any conversion, independent of registration order", async () => {
  const request = await input(), a = plugin("a", ["data.xp3"]), b = plugin("b", ["data.xp3"], 200), convert = vi.spyOn(a, "convert");
  for (const list of [[a, b], [b, a]]) {
    await expect(runNormalization(request, list)).rejects.toThrow("RUNTIME_NORMALIZATION_CONFLICT");
  }
  expect(convert).not.toHaveBeenCalled();
});
it("rejects conflicting output paths and writes over retained files during planning", async () => {
  const request = await input(), a = plugin("a", ["data.xp3"]), b = plugin("b", ["patch.xp3"]);
  const plan = (claims: string[], outputs: string[]): NormalizationPlan[] => [{format: "synthetic", claims, outputs}];
  a.probe = async () => plan(["data.xp3"], ["same.xp3"]);
  b.probe = async () => plan(["patch.xp3"], ["same.xp3"]);
  await expect(runNormalization(request, [a, b])).rejects.toThrow("RUNTIME_NORMALIZATION_CONFLICT");
  a.probe = async () => plan(["data.xp3"], ["readme.txt"]);
  await expect(runNormalization(request, [a])).rejects.toThrow("RUNTIME_NORMALIZATION_CONFLICT");
});
it("matched failure stops the import instead of trying another converter or returning source facts", async () => {
  const request = await input(), a = plugin("a", ["data.xp3"]), b = plugin("b", ["patch.xp3"]), second = vi.spyOn(b, "convert");
  a.convert = async () => {throw new Error("RUNTIME_TEST_CORRUPT_RESOURCE");};
  await expect(runNormalization(request, [a, b])).rejects.toThrow("RUNTIME_TEST_CORRUPT_RESOURCE");
  expect(second).not.toHaveBeenCalled();
});
it("validates emitted bytes against the conversion manifest", async () => {
  const request = await input(), a = plugin("a", ["data.xp3"]), convert = a.convert;
  a.convert = async (context, plan) => {
    const result = await convert(context, plan); result.files[0].sha256 = "0".repeat(64); return result;
  };
  await expect(runNormalization(request, [a])).rejects.toThrow("RUNTIME_NORMALIZATION_OUTPUT_INVALID");
});
it("keeps source content identity independent of plugin implementation versions", async () => {
  const request = await input(), a = plugin("a", ["data.xp3"]);
  const first = await runNormalization(request, [a]);
  await rm(request.outputRoot, {recursive: true}); await mkdir(request.outputRoot); a.version = 2;
  const second = await runNormalization(request, [a]);
  expect(second.files).toEqual(first.files);
  expect(second.normalization?.sourceContentHash).toBe(first.normalization?.sourceContentHash);
  expect(second.normalization?.plugins[0].version).toBe(2);
});
it("validates the static registry rather than silently accepting duplicate ids", async () => {
  const request = await input(), context = {...request, sourceContentHash: "a".repeat(64), cache: new Map()};
  await expect(planNormalization(context, [plugin("a", []), plugin("a", [])])).rejects.toThrow("RUNTIME_NORMALIZATION_REGISTRY_INVALID");
});
