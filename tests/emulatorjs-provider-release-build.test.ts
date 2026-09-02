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
  it("builds all 35 targets from one verified materialized input without downloads", {timeout: 30_000}, async () => {
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
        commit: "a".repeat(40), definition: emulatorJsProviderDefinition,
        entryPoint: join(process.cwd(), "src/providers/emulatorjs/module.ts"), manifest,
        outputRoot: join(root, "mismatched"), sourceCatalog: emulatorJsSourceCatalog, sourceRoot,
      })).rejects.toThrow("PROVIDER_RELEASE_BUILD_ASSET_MISMATCH");

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
        commit: "a".repeat(40), definition,
        entryPoint: join(process.cwd(), "src/providers/emulatorjs/module.ts"), manifest,
        outputRoot: join(root, "output"), sourceCatalog: emulatorJsSourceCatalog, sourceRoot,
      });

      const provider = JSON.parse(await readFile(join(result.bundleRoot, "provider.json"), "utf8")) as {
        providerId: string; targets: unknown[];
      };
      expect(provider.providerId).toBe("emulatorjs");
      expect(provider.targets).toHaveLength(35);
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
