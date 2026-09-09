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

describe("EmulatorJS Provider release build", () => {
  it("builds all 50 targets from one verified materialized input without downloads", {timeout: 30_000}, async () => {
    const root = await temporaryRoot();
    try {
      const sourceRoot = join(root, "source");
      const manifest = projectProviderManifest(emulatorJsProviderDefinition);
      for (const assetPath of new Set(manifest.targets.flatMap((target) => target.assetPaths))) {
        await write(join(sourceRoot, assetPath.replace(/^assets\//u, "")), `fixture:${assetPath}\n`);
      }
      for (const release of emulatorJsSourceCatalog.releases) {
        await write(join(sourceRoot, release.id, "LICENSE"), `${release.id} license\n`);
        await write(join(sourceRoot, release.id, "THIRD_PARTY_NOTICES"), `${release.id} notices\n`);
        await write(join(sourceRoot, release.id, "licenses/core/LICENSE"), `${release.id} core\n`);
      }

      await expect(buildEmulatorJsProviderBundle({
        definition: emulatorJsProviderDefinition,
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
        definition,
        entryPoint: join(process.cwd(), "src/providers/emulatorjs/module.ts"), manifest,
        outputRoot: join(root, "output"), sourceCatalog, sourceRoot,
      });

      const provider = JSON.parse(await readFile(join(result.bundleRoot, "provider.json"), "utf8")) as {
        providerId: string; targets: unknown[];
      };
      expect(provider.providerId).toBe("emulatorjs");
      expect(provider.targets).toHaveLength(50);
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
    const assets = fork.assets.filter((asset) => asset.filename !== "rpg-runtime-release.json").map((asset) => {
      const contents = asset.filename.endsWith(".data")
        ? `fixture:assets/4.2.3/data/cores/${asset.filename}\n` : `${fork.runtimeCore} fixture license\n`;
      return {...asset, contents, sha256: createHash("sha256").update(contents).digest("hex"),
        sizeBytes: Buffer.byteLength(contents)};
    });
    const metadata = JSON.stringify({...fork, schemaVersion: 1, assets: assets.map((asset) => ({
      filename: asset.filename, observedSha256: asset.sha256, sizeBytes: asset.sizeBytes,
    }))});
    const metadataAsset = fork.assets.find((asset) => asset.filename === "rpg-runtime-release.json")!;
    const all = [...assets, {...metadataAsset, contents: metadata,
      sha256: createHash("sha256").update(metadata).digest("hex"), sizeBytes: Buffer.byteLength(metadata)}];
    for (const asset of all) {
      const destination = asset.filename.endsWith(".data") ? `4.2.3/data/cores/${asset.filename}`
        : asset.filename.endsWith(".json") ? `4.2.3/data/cores/reports/${fork.runtimeCore}.json`
          : `4.2.3/licenses/forks/${fork.runtimeCore}/${asset.filename}`;
      await write(join(sourceRoot, destination), asset.contents);
    }
    forks.push({...fork, assets: all.map(({contents: _contents, ...asset}) => asset)});
  }
  return {...emulatorJsSourceCatalog, forks};
}
