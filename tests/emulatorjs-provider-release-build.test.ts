// @vitest-environment node

import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {describe, expect, it} from "vitest";

import {projectProviderManifest} from "../src/provider/manifest.js";
import {emulatorJsProviderDefinition} from "../src/providers/emulatorjs/catalog.js";
import {emulatorJsSourceCatalog} from "../src/providers/emulatorjs/source-catalog.js";
import {buildEmulatorJsProviderBundle} from "../scripts/provider-release-build.mjs";
import {developmentForkFiles} from "../scripts/emulatorjs-development-forks.mjs";
import type {DevelopmentFork} from "../scripts/emulatorjs-development-forks.mjs";
import {forkReleaseFiles} from "../scripts/emulatorjs-fork-releases.mjs";

describe("EmulatorJS Provider release build", () => {
  it("builds all 57 targets from one verified materialized input without downloads", {timeout: 30_000}, async () => {
    const root = await temporaryRoot();
    try {
      const sourceRoot = join(root, "source");
      const manifest = projectProviderManifest(emulatorJsProviderDefinition);
      for (const assetPath of new Set(manifest.targets.flatMap((target) => target.assetPaths))) {
        await write(join(sourceRoot, assetPath.replace(/^assets\//u, "")), `fixture:${assetPath}\n`);
      }
      for (const release of emulatorJsSourceCatalog.releases) {
        for (const path of release.licenseRoots.filter((path) => path.startsWith("licenses/"))) {
          await write(join(sourceRoot, release.id, path, "LICENSE"), `${release.id} custom core license\n`);
        }
        await write(join(sourceRoot, release.id, "LICENSE"), `${release.id} license\n`);
        await write(join(sourceRoot, release.id, "THIRD_PARTY_NOTICES"), `${release.id} notices\n`);
        await write(join(sourceRoot, release.id, "licenses/core/LICENSE"), `${release.id} core\n`);
      }

      await expect(buildEmulatorJsProviderBundle({
        allowDevelopmentForks: true, definition: emulatorJsProviderDefinition,
        entryPoint: join(process.cwd(), "src/providers/emulatorjs/module.ts"), manifest,
        outputRoot: join(root, "mismatched"), sourceCatalog: emulatorJsSourceCatalog, sourceRoot,
      })).rejects.toThrow("PROVIDER_RELEASE_BUILD_ASSET_MISMATCH");

      const sourceCatalog = await fixtureForks(sourceRoot);
      const definition = {
        ...emulatorJsProviderDefinition,
        targets: emulatorJsProviderDefinition.targets.map((target) => {
          const contents = `fixture:${target.implementation.coreAssetPath}\n`;
          return {...target, implementation: {
            ...target.implementation,
            coreSha256: createHash("sha256").update(contents).digest("hex"),
            coreSizeBytes: Buffer.byteLength(contents),
          }};
        }),
      };
      const result = await buildEmulatorJsProviderBundle({
        allowDevelopmentForks: true, definition,
        entryPoint: join(process.cwd(), "src/providers/emulatorjs/module.ts"), manifest,
        outputRoot: join(root, "output"), sourceCatalog, sourceRoot,
      });

      const provider = JSON.parse(await readFile(join(result.bundleRoot, "provider.json"), "utf8")) as {
        providerId: string; targets: unknown[];
      };
      expect(provider.providerId).toBe("emulatorjs");
      expect(provider.targets).toHaveLength(57);
      const provenance = JSON.parse(await readFile(join(result.bundleRoot, "provenance.json"), "utf8"));
      expect(provenance.forks).toEqual(sourceCatalog.forks);
      expect(await readFile(join(result.bundleRoot,
        "licenses/emulatorjs/4.2.3/licenses/forks/vice_xvic/COPYING"), "utf8"))
        .toBe("vice_xvic fixture license\n");
      expect(await readFile(result.archivePath)).toHaveLength(result.bundleSizeBytes);
      expect(await readFile(join(result.bundleRoot, "licenses/emulatorjs/4.2.3/LICENSE"), "utf8"))
        .toBe("4.2.3 license\n");
    } finally {
      await rm(root, {force: true, recursive: true});
    }
  });
});

async function write(path: string, value: string) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, value);
}
async function temporaryRoot() {
  return mkdtemp(join(tmpdir(), "emulatorjs-provider-release-"));
}

async function fixtureForks(sourceRoot: string) {
  const forks = [];
  for (const fork of emulatorJsSourceCatalog.forks) {
    const destinations = new Map(forkReleaseFiles({forks: [fork]}).map((file) => [file.filename, file.destination]));
    const metadataAsset = fork.assets.find((asset) => asset.filename.endsWith("-release.json"))!;
    const assets = fork.assets.filter((asset) => asset !== metadataAsset).map((asset) => {
      const contents = asset.filename.endsWith(".data")
        ? `fixture:assets/${destinations.get(asset.filename)}\n` : `${fork.runtimeCore} fixture license\n`;
      return {...asset, contents, sha256: createHash("sha256").update(contents).digest("hex"),
        sizeBytes: Buffer.byteLength(contents)};
    });
    const records = assets.map((asset) => ({filename: asset.filename, sizeBytes: asset.sizeBytes,
      ...(fork.runtimeCore === "flycast" ? {sha256: asset.sha256} : {observedSha256: asset.sha256})}));
    const metadata = JSON.stringify({...fork, schemaVersion: 1,
      ...(fork.runtimeCore === "flycast" ? {files: records} : {assets: records})});
    const all = [...assets, {...metadataAsset, contents: metadata,
      sha256: createHash("sha256").update(metadata).digest("hex"), sizeBytes: Buffer.byteLength(metadata)}];
    for (const file of forkReleaseFiles({forks: [{...fork, assets: all}]})) {
      await write(join(sourceRoot, file.destination), all.find((asset) => asset.filename === file.filename)!.contents);
    }
    forks.push({...fork, assets: all.map(({contents: _contents, ...asset}) => asset)});
  }
  return {...emulatorJsSourceCatalog, forks, developmentForks: await fixtureDevelopmentForks(sourceRoot)};
}

async function fixtureDevelopmentForks(root: string) {
  const result = [];
  const developmentForks: readonly DevelopmentFork[] = emulatorJsSourceCatalog.developmentForks;
  for (const fork of developmentForks) {
    const destinations = new Map(developmentForkFiles({developmentForks: [fork]}).map((file) => [file.filename, file.destination]));
    const content = (name: string) => name.endsWith(".data") ? `fixture:assets/${destinations.get(name)}\n` : `${name} fixture\n`;
    const files = fork.assets.filter((asset) => asset.filename !== "retrom-core-candidate.json").map((asset) => ({
      filename: asset.filename, sizeBytes: Buffer.byteLength(content(asset.filename)),
      sha256: createHash("sha256").update(content(asset.filename)).digest("hex"),
    }));
    const metadata = JSON.stringify({schemaVersion: 1, kind: "RETROM_CORE_CANDIDATE_V1", coreId: fork.runtimeCore,
      repository: fork.repository, branch: "feat/test-core", commit: fork.commit, dirty: false,
      sourceTreeSha256: fork.sourceTreeSha256, adapterAbi: fork.adapterAbi, files});
    const assets = [...files, {filename: "retrom-core-candidate.json", sizeBytes: Buffer.byteLength(metadata),
      sha256: createHash("sha256").update(metadata).digest("hex")}];
    for (const asset of assets) {
      const name = asset.filename;
      const destination = destinations.get(name)!;
      await write(join(root, destination), name.endsWith(".json") ? metadata : content(name));
    }
    result.push({...fork, assets});
  }
  return result;
}
