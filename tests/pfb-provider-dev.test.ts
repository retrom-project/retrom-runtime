// @vitest-environment node

import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {buildPFBProviderDev} from "../scripts/pfb-provider-dev.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {force: true, recursive: true})));
});

describe("PFB loose provider", () => {
  it("rebuilds only the client and local assets with a content revision", async () => {
    const root = await temporaryRoot();
    const installedRoot = join(root, "installed");
    const outputRoot = join(root, "dev");
    const bundle = "a".repeat(64);
    const installation = join(installedRoot, "retrom-runtime", bundle);
    await mkdir(join(installation, "assets/butterscotch"), {recursive: true});
    const baseAsset = "export const base=true;\n";
    await writeFile(join(installation, "assets/butterscotch/worker.mjs"), baseAsset);
    await writeFile(join(installation, "provider.json"), JSON.stringify({
      schemaVersion: 1,
      providerId: "retrom-runtime",
      providerVersion: "0.14.5",
      providerApiVersion: 1,
      clientModulePath: "client.mjs",
      targets: [{id: "butterscotch", assetPaths: ["assets/butterscotch/worker.mjs"]}],
    }));
    await writeFile(join(installation, "integrity.json"), JSON.stringify({
      schemaVersion: 1,
      files: [{
        path: "assets/butterscotch/worker.mjs",
        sizeBytes: Buffer.byteLength(baseAsset),
        sha256: sha256(baseAsset),
        mediaType: "text/javascript; charset=utf-8",
      }],
    }));
    const activePath = join(root, "active.json");
    await writeFile(activePath, JSON.stringify({
      schemaVersion: 1,
      providers: [{
        providerId: "retrom-runtime",
        bundleSha256: bundle,
        installationPath: `retrom-runtime/${bundle}`,
        targets: [{id: "butterscotch", checkpoint: null}],
      }],
    }));
    const localAsset = join(root, "worker.mjs");
    await writeFile(localAsset, "export const changed=1;\n");
    const entryPoint = join(root, "entry.ts");
    await writeFile(entryPoint, "export const providerApiVersion=1;\n");
    const first = await buildPFBProviderDev({
      activePath, entryPoint, installedRoot,
      localAssets: [{source: localAsset, output: "runtime/butterscotch/worker.mjs"}],
      outputRoot,
    });
    await writeFile(entryPoint, "export const providerApiVersion=2;\n");
    const second = await buildPFBProviderDev({
      activePath, entryPoint, installedRoot,
      localAssets: [{source: localAsset, output: "runtime/butterscotch/worker.mjs"}],
      outputRoot,
    });
    expect(second.revision).not.toBe(first.revision);
    const descriptor = JSON.parse(await readFile(join(outputRoot, "dev-provider.json"), "utf8"));
    expect(descriptor.revision).toBe(second.revision);
    expect(descriptor.baseBundleSha256).toBe(bundle);
    expect(descriptor.files.map((file: {path: string}) => file.path)).toEqual([
      "assets/butterscotch/worker.mjs", "client.mjs",
    ]);
    expect(await readFile(join(outputRoot, "revisions", second.revision,
      "assets/butterscotch/worker.mjs"), "utf8"))
      .toBe("export const changed=1;\n");
    expect(await readFile(join(outputRoot, "revisions", first.revision, "client.mjs"), "utf8"))
      .toContain("providerApiVersion");

    await writeFile(activePath, JSON.stringify({
      schemaVersion: 1,
      providers: [{
        providerId: "retrom-runtime",
        bundleSha256: bundle,
        installationPath: `retrom-runtime/${bundle}`,
        targets: [{
          id: "butterscotch", checkpoint: null, targetContractSha256: "b".repeat(64),
        }],
      }],
    }));
    await expect(buildPFBProviderDev({
      activePath, entryPoint, installedRoot,
      localAssets: [{source: localAsset, output: "runtime/butterscotch/worker.mjs"}],
      outputRoot,
    })).rejects.toThrow("PFB_PROVIDER_BASE_INVALID");
  });
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "retrom-pfb-provider-"));
  temporaryRoots.push(root);
  return root;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
