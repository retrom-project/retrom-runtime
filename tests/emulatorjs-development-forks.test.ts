// @vitest-environment node
import {describe, expect, it} from "vitest";
import {validateProviderSources} from "../scripts/provider-sources.mjs";
import {readFileSync} from "node:fs";

describe("unpublished Caprice32 source admission", () => {
  it("accepts the explicit source identity without inventing a release tag", () => {
    const sources = JSON.parse(readFileSync(new URL("../provider-sources.json", import.meta.url), "utf8"));
    sources.developmentInputs = [{id: "cap32", repository: "https://github.com/retrom-project/libretro-cap32",
      upstreamCommit: "310cc579b79b6051b378b192224b325a73437c9b", adapterAbi: "emulatorjs-state-v1"}];
    expect(() => validateProviderSources(sources)).not.toThrow();
    sources.developmentInputs[0].id = "undeclared";
    expect(() => validateProviderSources(sources)).toThrow("PROVIDER_SOURCES_INVALID");
  });
});

import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm, writeFile, symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach} from "vitest";
import {developmentForkFiles, requireDevelopmentForkMode, stageDevelopmentForks,
  verifyDevelopmentForkMetadata} from "../scripts/emulatorjs-development-forks.mjs";
const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));});
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture(core = "cap32") {
  const license = core === "bsnes" ? "LICENSE.txt" : core === "vecx" ? "LICENSE.md" : (core === "cap32" || core === "same_cdi" || core.startsWith("vice_")) ? "COPYING" : "LICENSE";
  const contents = new Map([...[license, `${core}-wasm.data`, "source.tar.gz"].map((name) =>
    [name, Buffer.from(`project-owned ${name} test bytes`)] as const)]);
  const files = [...contents].map(([filename, bytes]) => ({filename, sha256: sha(bytes), sizeBytes: bytes.length}));
  const metadata = {schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: core,
    repository: `https://github.com/retrom-project/${core === "bsnes" ? "bsnes-libretro" : core.startsWith("vice_") ? "vice-libretro" : core === "81" ? "81-libretro" : core === "same_cdi" ? "same_cdi" : `libretro-${core}`}`, branch: "feat/test-core",
    commit: "a".repeat(40), dirty: false, sourceTreeSha256: "b".repeat(64), adapterAbi: "emulatorjs-state-v1", files};
  const bytes = Buffer.from(JSON.stringify(metadata));
  contents.set("retrom-core-candidate.json", bytes);
  const fork = {runtimeCore: core, repository: metadata.repository,
    upstreamCommit: core === "uzem" ? "d991ee94547c8294abc1c4cb73d63116aa58b5bc" : core === "bsnes" ? "4b344745e3878e7c0675a60c624582935524b8f7" : core === "vecx" ? "8f671cc9d737f2890c3ce19e177e2984dcae121f" : core === "same_cdi" ? "cfb05d803f54130adf94efef88edd816d01df7a3" : core.startsWith("vice_") ? "1b4309f4d56ded7bfc5ad7ba8d5a9a44ac3388a8" : core === "cap32" ? "310cc579b79b6051b378b192224b325a73437c9b" : core === "81" ? "86decf3ee61ea5803972948e80197bee8474796b" : "be00fb904da08d66221017f6708508298f17ff07", commit: metadata.commit,
    sourceTreeSha256: metadata.sourceTreeSha256, adapterAbi: metadata.adapterAbi,
    assets: [...files, {filename: "retrom-core-candidate.json", sha256: sha(bytes), sizeBytes: bytes.length}]};
  return {contents, metadata, fork, catalog: {developmentForks: [fork]}};
}
async function directory() {const root = await mkdtemp(join(tmpdir(), "cap32-candidate-")); roots.push(root); return root;}

describe("EmulatorJS local core provenance", () => {
  it("stages the Uzebox fork and rejects source drift, tampering and production use", async () => {
    const {catalog, contents, fork, metadata} = fixture("uzem"), source = await directory(), output = await directory();
    for (const [name, bytes] of contents) {await writeFile(join(source, name), bytes);}
    await stageDevelopmentForks(catalog, new Map([["uzem", source]]), output);
    expect(await readFile(join(output, "4.2.3/data/cores/uzem-wasm.data"))).toEqual(contents.get("uzem-wasm.data"));
    expect(() => requireDevelopmentForkMode(catalog, false)).toThrow("UNPUBLISHED_CORE_INPUT");
    expect(() => developmentForkFiles({developmentForks: [{...fork, upstreamCommit: "a".repeat(40)}]})).toThrow();
    expect(() => verifyDevelopmentForkMetadata(fork, {...metadata, sourceTreeSha256: "c".repeat(64)})).toThrow();
    await writeFile(join(source, "uzem-wasm.data"), "tampered");
    await expect(stageDevelopmentForks(catalog, new Map([["uzem", source]]), output)).rejects.toThrow();
  });
  it("stages bsnes only under 4.3.0-pre and forbids unpublished production inputs", async () => {
    const {catalog, contents, fork, metadata} = fixture("bsnes"), source = await directory(), output = await directory();
    for (const [name, bytes] of contents) {await writeFile(join(source, name), bytes);}
    await stageDevelopmentForks(catalog, new Map([["bsnes", source]]), output);
    expect(await readFile(join(output, "4.3.0-pre/data/cores/bsnes-wasm.data"))).toEqual(contents.get("bsnes-wasm.data"));
    expect(await readFile(join(output, "4.3.0-pre/licenses/forks/bsnes/LICENSE.txt"))).toEqual(contents.get("LICENSE.txt"));
    expect(developmentForkFiles(catalog).every((file) => file.destination.startsWith("4.3.0-pre/"))).toBe(true);
    expect(() => requireDevelopmentForkMode(catalog, false)).toThrow("UNPUBLISHED_CORE_INPUT");
    expect(() => verifyDevelopmentForkMetadata(fork, {...metadata, repository: "https://github.com/EmulatorJS/bsnes-libretro"})).toThrow();
    await writeFile(join(source, "bsnes-wasm.data"), "tampered");
    await expect(stageDevelopmentForks(catalog, new Map([["bsnes", source]]), output)).rejects.toThrow();
  });
  it("stages three declared forks separately and rejects duplicate identities", async () => {
    const cap = fixture(), croco = fixture("crocods"), eightyOne = fixture("81"), output = await directory();
    const catalog = {developmentForks: [cap.fork, croco.fork, eightyOne.fork]}, inputs = new Map<string, string>();
    for (const entry of [cap, croco, eightyOne]) {
      const source = await directory(); inputs.set(entry.fork.runtimeCore, source);
      for (const [name, bytes] of entry.contents) {await writeFile(join(source, name), bytes);}
    }
    await stageDevelopmentForks(catalog, inputs, output);
    expect(await readFile(join(output, "4.2.3/data/cores/crocods-wasm.data"))).toEqual(croco.contents.get("crocods-wasm.data"));
    expect(await readFile(join(output, "4.2.3/licenses/forks/crocods/LICENSE"))).toEqual(croco.contents.get("LICENSE"));
    expect(await readFile(join(output, "4.2.3/data/cores/81-wasm.data"))).toEqual(eightyOne.contents.get("81-wasm.data"));
    expect(() => developmentForkFiles({developmentForks: [cap.fork, cap.fork]})).toThrow();
  });
  it.each(["vice_xpet", "vice_xplus4"])("stages the declared %s variant with its source and rejects a swapped variant", async (core) => {
    const {catalog, contents, fork, metadata} = fixture(core), source = await directory(), output = await directory();
    for (const [name, bytes] of contents) {await writeFile(join(source, name), bytes);}
    await stageDevelopmentForks(catalog, new Map([[core, source]]), output);
    expect(await readFile(join(output, `4.2.3/data/cores/${core}-wasm.data`))).toEqual(contents.get(`${core}-wasm.data`));
    expect(await readFile(join(output, `4.2.3/licenses/forks/${core}/source.tar.gz`))).toEqual(contents.get("source.tar.gz"));
    expect(() => verifyDevelopmentForkMetadata(fork, {...metadata, coreId: core === "vice_xpet" ? "vice_xplus4" : "vice_xpet"})).toThrow();
  });
  it("stages the Vectrex fork and rejects unpublished source drift", async () => {
    const {catalog, contents, fork} = fixture("vecx"), source = await directory(), output = await directory();
    for (const [name, bytes] of contents) {await writeFile(join(source, name), bytes);}
    await stageDevelopmentForks(catalog, new Map([["vecx", source]]), output);
    expect(await readFile(join(output, "4.2.3/data/cores/vecx-wasm.data"))).toEqual(contents.get("vecx-wasm.data"));
    expect(await readFile(join(output, "4.2.3/licenses/forks/vecx/LICENSE.md"))).toEqual(contents.get("LICENSE.md"));
    expect(() => requireDevelopmentForkMode(catalog, false)).toThrow("UNPUBLISHED_CORE_INPUT");
    expect(() => developmentForkFiles({developmentForks: [{...fork, upstreamCommit: "a".repeat(40)}]})).toThrow();
  });
  it("stages the CD-i timing fix with its exact source identity and license", async () => {
    const {catalog, contents, fork, metadata} = fixture("same_cdi"), source = await directory(), output = await directory();
    for (const [name, bytes] of contents) {await writeFile(join(source, name), bytes);}
    await stageDevelopmentForks(catalog, new Map([["same_cdi", source]]), output);
    expect(await readFile(join(output, "4.2.3/data/cores/same_cdi-wasm.data"))).toEqual(contents.get("same_cdi-wasm.data"));
    expect(await readFile(join(output, "4.2.3/licenses/forks/same_cdi/COPYING"))).toEqual(contents.get("COPYING"));
    expect(() => developmentForkFiles({developmentForks: [{...fork, upstreamCommit: "a".repeat(40)}]})).toThrow();
    expect(() => verifyDevelopmentForkMetadata(fork, {...metadata, coreId: "cap32"})).toThrow();
  });
  it("rejects formal builds and undeclared core identities", () => {
    const {catalog, fork} = fixture();
    expect(() => requireDevelopmentForkMode(catalog, false)).toThrow("UNPUBLISHED_CORE_INPUT");
    expect(() => requireDevelopmentForkMode(catalog, true)).not.toThrow();
    expect(() => developmentForkFiles({developmentForks: [{...fork, runtimeCore: "other"}]})).toThrow();
    expect(() => developmentForkFiles({developmentForks: [{...fork, assets: [...fork.assets, fork.assets[0]]}]})).toThrow();
  });
  it("verifies every byte and keeps the source archive with the license material", async () => {
    const {catalog, contents} = fixture(), source = await directory(), output = await directory();
    for (const [name, bytes] of contents) {await writeFile(join(source, name), bytes);}
    await stageDevelopmentForks(catalog, new Map([["cap32", source]]), output);
    expect(await readFile(join(output, "4.2.3/data/cores/cap32-wasm.data"))).toEqual(contents.get("cap32-wasm.data"));
    expect(await readFile(join(output, "4.2.3/licenses/forks/cap32/source.tar.gz"))).toEqual(contents.get("source.tar.gz"));
    await writeFile(join(source, "cap32-wasm.data"), "tampered");
    await expect(stageDevelopmentForks(catalog, new Map([["cap32", source]]), output)).rejects.toThrow();
  });
  it("rejects missing roots, symbolic links and unexpected outputs", async () => {
    const {catalog, contents} = fixture(), source = await directory(), output = await directory();
    await expect(stageDevelopmentForks(catalog, new Map(), output)).rejects.toThrow();
    for (const [name, bytes] of contents) {await writeFile(join(source, name), bytes);}
    await writeFile(join(source, "unexpected"), "extra");
    await expect(stageDevelopmentForks(catalog, new Map([["cap32", source]]), output)).rejects.toThrow();
    await rm(join(source, "unexpected")); await rm(join(source, "COPYING"));
    await symlink(join(source, "source.tar.gz"), join(source, "COPYING"));
    await expect(stageDevelopmentForks(catalog, new Map([["cap32", source]]), output)).rejects.toThrow();
  });
  it("rejects wrong source identities and metadata file lists", () => {
    const {fork, metadata} = fixture();
    expect(() => verifyDevelopmentForkMetadata(fork, metadata)).not.toThrow();
    for (const altered of [{...metadata, commit: "c".repeat(40)}, {...metadata, sourceTreeSha256: "c".repeat(64)},
      {...metadata, coreId: "other"}, {...metadata, files: metadata.files.slice(1)}]) {
      expect(() => verifyDevelopmentForkMetadata(fork, altered)).toThrow();
    }
  });
});
