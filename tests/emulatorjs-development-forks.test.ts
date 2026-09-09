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
function fixture() {
  const contents = new Map([...["COPYING", "cap32-wasm.data", "source.tar.gz"].map((name) =>
    [name, Buffer.from(`project-owned ${name} test bytes`)] as const)]);
  const files = [...contents].map(([filename, bytes]) => ({filename, sha256: sha(bytes), sizeBytes: bytes.length}));
  const metadata = {schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: "cap32",
    repository: "https://github.com/retrom-project/libretro-cap32", branch: "feat/test-core",
    commit: "a".repeat(40), dirty: false, sourceTreeSha256: "b".repeat(64), adapterAbi: "emulatorjs-state-v1", files};
  const bytes = Buffer.from(JSON.stringify(metadata));
  contents.set("retrom-core-candidate.json", bytes);
  const fork = {runtimeCore: "cap32", repository: metadata.repository,
    upstreamCommit: "310cc579b79b6051b378b192224b325a73437c9b", commit: metadata.commit,
    sourceTreeSha256: metadata.sourceTreeSha256, adapterAbi: metadata.adapterAbi,
    assets: [...files, {filename: "retrom-core-candidate.json", sha256: sha(bytes), sizeBytes: bytes.length}]};
  return {contents, metadata, fork, catalog: {developmentForks: [fork]}};
}
async function directory() {const root = await mkdtemp(join(tmpdir(), "cap32-candidate-")); roots.push(root); return root;}

describe("EmulatorJS local core provenance", () => {
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
