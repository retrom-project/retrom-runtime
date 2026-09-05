// @vitest-environment node

import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
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
  it("atomically replaces one complete dev provider without retaining history", async () => {
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
      providerVersion: "0.16.5",
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
    expect(second.moduleSha256).not.toBe(first.moduleSha256);
    const descriptor = JSON.parse(await readFile(join(outputRoot, "dev-provider.json"), "utf8"));
    expect(Object.keys(descriptor).sort()).toEqual(["baseBundleSha256", "files", "providerId", "schemaVersion"]);
    expect(await readdir(outputRoot)).toEqual(["dev-provider.json"]);
    expect(descriptor.baseBundleSha256).toBe(bundle);
    expect(descriptor.files.map((file: {path: string}) => file.path)).toEqual([
      "assets/butterscotch/worker.mjs", "client.mjs",
    ]);
    expect(Buffer.from(descriptor.files[0].contentBase64, "base64").toString("utf8"))
      .toBe("export const changed=1;\n");
    const client = Buffer.from(descriptor.files[1].contentBase64, "base64").toString("utf8");
    expect(client).toMatch(/=2;/u);
    expect(client).toContain("providerApiVersion");
    expect(sha256(client)).toBe(second.moduleSha256);

    // A failed rebuild cannot replace the complete, previously working payload.
    const published = await readFile(join(outputRoot, "dev-provider.json"), "utf8");
    await writeFile(entryPoint, "export const = ;\n");
    await expect(buildPFBProviderDev({
      activePath, entryPoint, installedRoot,
      localAssets: [{source: localAsset, output: "runtime/butterscotch/worker.mjs"}],
      outputRoot,
    })).rejects.toThrow();
    expect(await readFile(join(outputRoot, "dev-provider.json"), "utf8")).toBe(published);
    expect(await readdir(outputRoot)).toEqual(["dev-provider.json"]);

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
