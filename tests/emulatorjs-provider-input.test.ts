// @vitest-environment node

import {createHash} from "node:crypto";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";

import {materializeEmulatorJsProviderInput} from "../scripts/emulatorjs-provider-input.mjs";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {force: true, recursive: true})));
});

describe("EmulatorJS Provider input materializer", () => {
  it("verifies pinned downloads, selects only declared files and reuses a verified cache", async () => {
    const root = await temporaryRoot();
    const archive = Buffer.from("pinned archive");
    const override = Buffer.from("override core");
    const fetchBytes = vi.fn(async (url: string) => url.endsWith("override.data") ? override : archive);
    const extractArchive = vi.fn(async (_archive: string, destination: string, selections: string[]) => {
      expect(selections).toEqual(["LICENSE", "THIRD_PARTY_NOTICES", "data/core.data", "data/loader.js", "licenses"]);
      await write(join(destination, "LICENSE"), "license\n");
      await write(join(destination, "THIRD_PARTY_NOTICES"), "notices\n");
      await write(join(destination, "licenses/core/LICENSE"), "core license\n");
      await write(join(destination, "data/core.data"), "archive core\n");
      await write(join(destination, "data/loader.js"), "loader\n");
    });
    const input = {
      cacheRoot: join(root, "downloads"),
      catalog: {
        overrides: [{
          destination: "1.0.0/data/core.data", runtimeCore: "core",
          sha256: sha256(override), sizeBytes: override.byteLength,
          sourceRelease: "0.9.0", url: "https://example.invalid/override.data",
        }],
        releases: [{
          archive: {name: "runtime.7z", sha256: sha256(archive), sizeBytes: archive.byteLength,
            url: "https://example.invalid/runtime.7z"},
          commit: "a".repeat(40), id: "1.0.0", licenseRoots: ["LICENSE", "THIRD_PARTY_NOTICES", "licenses"],
          repository: "https://example.invalid/runtime", tag: "v1.0.0",
        }],
        schemaVersion: 1,
      },
      definition: {targets: [{assetPaths: ["assets/1.0.0/data/core.data", "assets/1.0.0/data/loader.js"], implementation: {
        coreAssetPath: "assets/1.0.0/data/core.data", coreSha256: sha256(override),
        coreSizeBytes: override.byteLength, release: "1.0.0", runtimeCore: "core",
      }}]},
      extractArchive,
      fetchBytes,
      outputRoot: join(root, "input"),
    };

    await materializeEmulatorJsProviderInput(input);
    await materializeEmulatorJsProviderInput(input);

    expect(fetchBytes).toHaveBeenCalledTimes(2);
    expect(extractArchive).toHaveBeenCalledTimes(1);
  });
});

async function write(path: string, value: string) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, value);
}
async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "emulatorjs-provider-input-"));
  temporaryRoots.push(root);
  return root;
}
function sha256(value: Uint8Array) {return createHash("sha256").update(value).digest("hex");}
