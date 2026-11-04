// @vitest-environment node
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {afterEach, expect, it} from "vitest";
import {buildProviderBundle} from "../scripts/provider-bundle.mjs";
import {chunkProviderBundle} from "../scripts/provider-chunks.mjs";
import {writeRuntimeInputs, writeRebuiltRuntimeInputs} from "../scripts/runtime-inputs.mjs";
const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
async function fixture(version = "1.2.3", versions: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "runtime-paired-")); roots.push(root);
  const providers = [];
  for (const id of ["emulatorjs", "retrom-runtime"]) {
    const license = join(root, `${id}-LICENSE`); await writeFile(license, "MIT");
    const bundle = await buildProviderBundle({bundleRoot: join(root, id),
      clientModuleBytes: Buffer.from(`export const providerId=${JSON.stringify(id)};`),
      assetSources: new Map(), licenseSources: new Map([["licenses/LICENSE", license]]), provenance: {schemaVersion: 1, runtimeSourceTreeSha256: "a".repeat(64)},
      manifest: {schemaVersion: 1, providerId: id, providerVersion: versions[id] ?? version, providerApiVersion: 1,
        clientModulePath: "client.mjs", targets: [{assetPaths: []}]}});
    const chunkRoot = join(root, `${id}-chunks`);
    providers.push({...bundle, chunkRoot, chunks: await chunkProviderBundle({bundleRoot: bundle.bundleRoot,
      providerId: id, providerVersion: versions[id] ?? version, outputRoot: chunkRoot})});
  }
  const outputRoot = join(root, "out"); await mkdir(outputRoot);
  return {outputRoot, sourceTreeSha256: "a".repeat(64), providers};
}
it("emits one local paired identity from actual chunks and verified client bytes", async () => {
  const input = await fixture(), result = await writeRuntimeInputs(input);
  expect(result.release).toBeNull();
  expect(result.schemaVersion).toBe(2);
  expect(result).not.toHaveProperty("tool");
  expect(result.providers.map(record => record.chunkManifest.asset)).toEqual([
    "emulatorjs-chunks-1.2.3.json", "retrom-runtime-chunks-1.2.3.json"]);
  expect(result.providers.every(record => record.moduleSha256.length === 64 && !("archive" in record))).toBe(true);
  for (const provider of input.providers) {
    const manifest = JSON.parse(await readFile(provider.chunks.manifestPath, "utf8")) as {chunks: Array<{archive: string}>};
    expect(await readFile(join(input.outputRoot, provider.chunks.manifestPath.split("/").at(-1)!)))
      .toEqual(await readFile(provider.chunks.manifestPath));
    for (const chunk of manifest.chunks) {
      expect(await readFile(join(input.outputRoot, chunk.archive))).toEqual(await readFile(join(provider.chunkRoot, chunk.archive)));
    }
  }
  expect(JSON.parse(await readFile(join(input.outputRoot, "runtime-inputs.json"), "utf8"))).toEqual(result);
});
it("rejects a different source claim even when all chunk bytes are intact", async () => {
  const input = await fixture();
  await expect(writeRuntimeInputs({...input, sourceTreeSha256: "c".repeat(64)})).rejects.toThrow("RUNTIME_INPUTS_INVALID");
  await expect(readFile(join(input.outputRoot, "runtime-inputs.json"))).rejects.toMatchObject({code: "ENOENT"});
});
it("rejects a pair whose Providers do not share one version", async () => {
  const input = await fixture("1.2.3", {"retrom-runtime": "1.2.4"});
  await expect(writeRuntimeInputs(input)).rejects.toThrow("RUNTIME_INPUTS_INVALID");
  await expect(readFile(join(input.outputRoot, "runtime-inputs.json"))).rejects.toMatchObject({code: "ENOENT"});
});
it("tags the same schema only with an exact matching immutable version", async () => {
  const input = await fixture(), release = {repository: "https://github.com/retrom-project/retrom-runtime",
    tag: "v1.2.3", commit: "b".repeat(40)};
  expect((await writeRuntimeInputs({...input, release})).release).toEqual(release);
  await expect(writeRuntimeInputs({...input, release: {...release, tag: "v1.2.4"}})).rejects.toThrow("RUNTIME_INPUTS_INVALID");
});
it("uses the existing formal stable/RC tag rules without leading zeroes", async () => {
  const input = await fixture("1.2.3-rc.1"), release = {repository: "https://github.com/retrom-project/retrom-runtime",
    tag: "v1.2.3-rc.1", commit: "b".repeat(40)};
  expect((await writeRuntimeInputs({...input, release})).release).toEqual(release);
  for (const tag of ["v01.2.3", "v1.02.3", "v1.2.03", "v1.2.3-rc.0", "v1.2.3-rc.01", "v1.2.3-dev.1"]) {
    await expect(writeRuntimeInputs({...input, release: {...release, tag}})).rejects.toThrow("RUNTIME_INPUTS_INVALID");
  }
});
it.each(["provider", "client"])("rejects changed %s bytes before emitting a trusted pin", async part => {
  const input = await fixture();
  const firstChunk = (JSON.parse(await readFile(input.providers[0].chunks.manifestPath, "utf8")) as
    {chunks: Array<{archive: string}>}).chunks[0].archive;
  const path = part === "provider" ? join(input.providers[0].chunkRoot, firstChunk) :
    join(input.providers[0].bundleRoot, "client.mjs");
  await writeFile(path, "changed");
  await expect(writeRuntimeInputs(input)).rejects.toThrow();
  await expect(readFile(join(input.outputRoot, "runtime-inputs.json"))).rejects.toMatchObject({code: "ENOENT"});
});

it("creates complete paired transport from rebuilt bundles without preexisting chunks", async () => {
  const input = await fixture();
  const providers = input.providers.map(({bundleRoot, bundleSha256, fileCount, manifestSha256, unpackedSizeBytes}) =>
    ({bundleRoot, bundleSha256, fileCount, manifestSha256, unpackedSizeBytes}));
  const result = await writeRebuiltRuntimeInputs({...input, providers});
  expect(result.release).toBeNull();
  expect(result.providers).toHaveLength(2);
  for (const provider of result.providers) {
    const manifest = JSON.parse(await readFile(join(input.outputRoot, provider.chunkManifest.asset), "utf8")) as
      {bundleSha256: string; chunks: Array<{archive: string; archiveSha256: string}>};
    expect(manifest.bundleSha256).toBe(provider.bundleSha256);
    expect(manifest.chunks.length).toBeGreaterThan(0);
    for (const chunk of manifest.chunks) {
      const bytes = await readFile(join(input.outputRoot, chunk.archive));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(chunk.archiveSha256);
    }
  }
});
