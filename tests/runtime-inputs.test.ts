// @vitest-environment node
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {afterEach, expect, it} from "vitest";
import {buildProviderBundle} from "../scripts/provider-bundle.mjs";
import {writeRuntimeInputs} from "../scripts/runtime-inputs.mjs";
import {buildVersion} from "../scripts/release-version.mjs";
import {buildRuntimeHostTool} from "../scripts/runtime-host-tool.mjs";
const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
async function fixture(version = "1.2.3") {
  const root = await mkdtemp(join(tmpdir(), "runtime-paired-")); roots.push(root);
  const toolName = `retrom-runtime-host-tool-${version}`, toolPath = join(root, `${toolName}.tar.gz`);
  await mkdir(join(root, toolName));
  await writeFile(join(root, toolName, "host-tool.json"), JSON.stringify({schemaVersion: 1, version, sourceTreeSha256: "a".repeat(64)}));
  execFileSync("tar", ["-czf", toolPath, "-C", root, toolName]);
  const bytes = await readFile(toolPath);
  const providers = [];
  for (const id of ["emulatorjs", "retrom-runtime"]) {
    const license = join(root, `${id}-LICENSE`); await writeFile(license, "MIT");
    providers.push(await buildProviderBundle({archiveRoot: join(root, "archives"), bundleRoot: join(root, id),
      clientModuleBytes: Buffer.from(`export const providerId=${JSON.stringify(id)};`),
      assetSources: new Map(), licenseSources: new Map([["licenses/LICENSE", license]]), provenance: {schemaVersion: 1, runtimeSourceTreeSha256: "a".repeat(64)},
      manifest: {schemaVersion: 1, providerId: id, providerVersion: version, providerApiVersion: 1,
        clientModulePath: "client.mjs", targets: [{assetPaths: []}]}}));
  }
  const outputRoot = join(root, "out"); await mkdir(outputRoot);
  return {outputRoot, sourceTreeSha256: "a".repeat(64), providers,
    tool: {archivePath: toolPath, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")}};
}
it("emits one local paired identity from actual archives and verified client bytes", async () => {
  const input = await fixture(), result = await writeRuntimeInputs(input);
  expect(result.release).toBeNull();
  expect(result.providers.map(record => record.archive)).toEqual([
    "emulatorjs/emulatorjs-provider-1.2.3.tar.gz", "retrom-runtime/retrom-runtime-provider-1.2.3.tar.gz"]);
  expect(result.providers.every(record => record.moduleSha256.length === 64)).toBe(true);
  expect(await readFile(join(input.outputRoot, result.tool.archive))).toEqual(await readFile(input.tool.archivePath));
  for (const provider of input.providers) {
    expect(await readFile(join(input.outputRoot, provider.archivePath.split("/").at(-1)!))).toEqual(await readFile(provider.archivePath));
  }
  expect(JSON.parse(await readFile(join(input.outputRoot, "runtime-inputs.json"), "utf8"))).toEqual(result);
});
it("rejects a different source claim even when all archive bytes are intact", async () => {
  const input = await fixture();
  await expect(writeRuntimeInputs({...input, sourceTreeSha256: "c".repeat(64)})).rejects.toThrow("RUNTIME_INPUTS_INVALID");
  await expect(readFile(join(input.outputRoot, "runtime-inputs.json"))).rejects.toMatchObject({code: "ENOENT"});
});
it("packages the numbered development version accepted by the public candidate entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-versioned-tool-")); roots.push(root);
  const version = buildVersion({RETROM_PFB_CANDIDATE_BUILD: "1", RETROM_PFB_CANDIDATE_VERSION: "0.59.1-dev.1"});
  const result = await buildRuntimeHostTool({repositoryRoot: process.cwd(), outputRoot: root,
    version, sourceTreeSha256: "a".repeat(64)});
  expect(result.archivePath).toBe(join(root, "retrom-runtime-host-tool-0.59.1-dev.1.tar.gz"));
  expect(JSON.parse(execFileSync("tar", ["-xOf", result.archivePath,
    "retrom-runtime-host-tool-0.59.1-dev.1/host-tool.json"], {encoding: "utf8"})).version).toBe(version);
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
it.each(["tool", "provider", "client"])("rejects changed %s bytes before emitting a trusted pin", async part => {
  const input = await fixture();
  const path = part === "tool" ? input.tool.archivePath : part === "provider" ? input.providers[0].archivePath :
    join(input.providers[0].bundleRoot, "client.mjs");
  await writeFile(path, "changed");
  await expect(writeRuntimeInputs(input)).rejects.toThrow();
  await expect(readFile(join(input.outputRoot, "runtime-inputs.json"))).rejects.toMatchObject({code: "ENOENT"});
});
