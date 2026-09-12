// @vitest-environment node
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, expect, it} from "vitest";
import {readPFBProviderCoreFiles} from "../scripts/pfb-provider-cores.mjs";
import {buildPFBProviderDev} from "../scripts/pfb-provider-dev.mjs";
import {emulatorJsProviderDefinition} from "../src/providers/emulatorjs/catalog.js";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));});
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const corePath = "assets/4.2.3/data/cores/cap32-wasm.data";

it("binds the compiled implementation to verified candidate bytes without changing public targets", async () => {
  const {root, index} = await fixture();
  const bundle = "d".repeat(64), installedRoot = join(root, "installed");
  const installation = join(installedRoot, "emulatorjs", bundle);
  await mkdir(installation, {recursive: true});
  await writeFile(join(installation, "provider.json"), JSON.stringify({providerId: "emulatorjs"}));
  await writeFile(join(installation, "integrity.json"), JSON.stringify({files: [{path: corePath, ...index[corePath]}]}));
  const activePath = join(root, "active.json"), entryPoint = join(root, "entry.ts");
  await writeFile(activePath, JSON.stringify({providers: [{providerId: "emulatorjs", bundleSha256: bundle,
    installationPath: `emulatorjs/${bundle}`, targets: [{id: "cap32", checkpoint: null}]}]}));
  const catalogPath = new URL("../src/providers/emulatorjs/catalog.ts", import.meta.url).pathname;
  await writeFile(entryPoint, `export {emulatorJsProviderDefinition as definition} from ${JSON.stringify(catalogPath)};`);
  await buildPFBProviderDev({activePath, entryPoint, installedRoot, providerId: "emulatorjs", localAssets: [], outputRoot: root});
  const payload = JSON.parse(await readFile(join(root, "dev-provider.json"), "utf8"));
  const client = payload.files.find((file: {path: string}) => file.path === "client.mjs");
  const {definition} = await import(`data:text/javascript;base64,${client.contentBase64}`);
  expect(definition.targets).toHaveLength(emulatorJsProviderDefinition.targets.length);
  for (const original of emulatorJsProviderDefinition.targets) {
    const selected = definition.targets.find((target: {id: string}) => target.id === original.id);
    if (original.id !== "cap32") {expect(selected).toEqual(original); continue;}
    expect(selected.implementation).toMatchObject({coreSha256: digest("owned core fixture"), coreSizeBytes: 18});
    expect({...selected, implementation: original.implementation}).toEqual(original);
  }
  expect(payload.files.find((file: {path: string}) => file.path === corePath).mediaType).toBe("application/octet-stream");
});

it("verifies an explicitly selected, declared fork candidate including sources and license", async () => {
  const {root, directory, index} = await fixture();
  const files = await readPFBProviderCoreFiles(root, "emulatorjs", join(root, "staging"), index);
  expect(files.map((file) => file.path).sort()).toEqual([
    corePath, "assets/4.2.3/data/cores/reports/cap32.json",
    "licenses/emulatorjs/4.2.3/licenses/forks/cap32/COPYING",
    "licenses/emulatorjs/4.2.3/licenses/forks/cap32/source.tar.gz",
  ]);
  expect(files.find((file) => file.path === corePath)?.contents.toString()).toBe("owned core fixture");
  await writeFile(join(directory, "cap32-wasm.data"), "tampered core data");
  await expect(readPFBProviderCoreFiles(root, "emulatorjs", join(root, "tampered"), index))
    .rejects.toThrow("EMULATORJS_DEVELOPMENT_FORK_INVALID");
});

it("rejects an undeclared core, a missing base asset, a foreign provider and mismatched metadata", async () => {
  const {root, directory, index, descriptor} = await fixture();
  await expect(readPFBProviderCoreFiles(root, "retrom-runtime", join(root, "staging"), index))
    .rejects.toThrow("PFB_PROVIDER_CORE_INPUT_INVALID");
  await expect(readPFBProviderCoreFiles(root, "emulatorjs", join(root, "staging"), {}))
    .rejects.toThrow("PFB_PROVIDER_CORE_INPUT_INVALID");
  await writeFile(join(directory, "retrom-core-candidate.json"), JSON.stringify({...descriptor, repository: "https://invalid.test/core"}));
  await expect(readPFBProviderCoreFiles(root, "emulatorjs", join(root, "staging"), index))
    .rejects.toThrow("EMULATORJS_DEVELOPMENT_FORK_INVALID");
  await writeFile(join(root, "core-inputs.json"), JSON.stringify({schemaVersion: 1, cores: [{id: "undeclared", directory}]}));
  await expect(readPFBProviderCoreFiles(root, "emulatorjs", join(root, "staging"), index)).rejects.toThrow();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pfb-core-input-"));
  roots.push(root);
  const directory = join(root, "candidate");
  await mkdir(directory);
  expect(await readPFBProviderCoreFiles(root, "emulatorjs", join(root, "empty"), {})).toEqual([]);
  const contents = {COPYING: "owned license fixture", "cap32-wasm.data": "owned core fixture", "source.tar.gz": "owned source fixture"};
  const files = Object.entries(contents).map(([filename, value]) => ({filename, sizeBytes: Buffer.byteLength(value), sha256: digest(value)}));
  await Promise.all(Object.entries(contents).map(([name, value]) => writeFile(join(directory, name), value)));
  const descriptor = {schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: "cap32",
    repository: "https://github.com/retrom-project/libretro-cap32", branch: "fix/plus-snapshot", commit: "a".repeat(40),
    sourceTreeSha256: "b".repeat(64), dirty: true, adapterAbi: "emulatorjs-state-v1", files};
  await writeFile(join(directory, "retrom-core-candidate.json"), JSON.stringify(descriptor));
  await writeFile(join(root, "core-inputs.json"), JSON.stringify({schemaVersion: 1, cores: [{id: "cap32", directory}]}));
  return {root, directory, descriptor, index: {[corePath]: {sha256: "c".repeat(64), sizeBytes: 10}}};
}
