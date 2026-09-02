// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { projectProviderManifest } from "../src/provider/manifest.js";
import { retromRuntimeProviderDefinition } from "../src/providers/retrom-runtime/catalog.js";
import {
  buildRetromRuntimeProviderBundle, canonicalJsonBytes, targetContractDigests,
} from "../scripts/provider-release-build.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {force: true, recursive: true})));
});

describe("retrom-runtime Provider release build", () => {
  it("canonicalizes object keys by UTF-16 code units", () => {
    expect(canonicalJsonBytes({"\ue000": 1, "𐀀": 2}).toString())
      .toBe('{"𐀀":2,"":1}');
  });

  it("changes a Target contract digest when any declared asset digest changes", () => {
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
    const assetIndex = Object.fromEntries([...new Set(manifest.targets.flatMap((target) => target.assetPaths))]
      .map((path) => [path, {sha256: "a".repeat(64), sizeBytes: 1}]));
    const first = targetContractDigests(manifest, assetIndex);
    const target = manifest.targets[0];
    const changedPath = target?.assetPaths[0];
    if (!target || !changedPath) {throw new Error("missing target fixture");}
    const second = targetContractDigests(manifest, {
      ...assetIndex,
      [changedPath]: {sha256: "b".repeat(64), sizeBytes: 1},
    });
    expect(second[target.id]).not.toBe(first[target.id]);
  });

  it("builds all twelve targets from one staged release without downloading cores", async () => {
    const root = await temporaryRoot();
    const stageRoot = join(root, "stage");
    const manifest = projectProviderManifest(retromRuntimeProviderDefinition);
    await stageAssets(stageRoot, manifest.targets.flatMap((target) => target.assetPaths));
    await write(join(stageRoot, "LICENSE"), "runtime license\n");
    await write(join(stageRoot, "THIRD_PARTY_NOTICES.md"), "notices\n");
    await write(join(stageRoot, "licenses/wasm4/LICENSE.txt"), "core license\n");

    const first = await buildRetromRuntimeProviderBundle({
      commit: "a".repeat(40),
      definition: retromRuntimeProviderDefinition,
      entryPoint: join(process.cwd(), "src/providers/retrom-runtime/module.ts"),
      manifest,
      outputRoot: join(root, "first"),
      stageRoot,
    });
    const second = await buildRetromRuntimeProviderBundle({
      commit: "a".repeat(40),
      definition: retromRuntimeProviderDefinition,
      entryPoint: join(process.cwd(), "src/providers/retrom-runtime/module.ts"),
      manifest,
      outputRoot: join(root, "second"),
      stageRoot,
    });
    expect(first.bundleSha256).toBe(second.bundleSha256);
    expect(await readFile(first.archivePath)).toEqual(await readFile(second.archivePath));

    const provider = JSON.parse(await readFile(join(first.bundleRoot, "provider.json"), "utf8")) as {
      targets: Array<Record<string, unknown>>;
    };
    expect(provider.targets).toHaveLength(12);
    expect(provider.targets.some((target) => target.id === "wasm4")).toBe(true);
    expect(provider.targets.every((target) => !("adapterId" in target))).toBe(true);
    expect(await readFile(join(first.bundleRoot, "client.mjs"), "utf8")).toContain("retrom-runtime");
  }, 20_000);
});

async function stageAssets(stageRoot: string, assetPaths: string[]) {
  for (const assetPath of new Set(assetPaths)) {
    const stagePath = join(stageRoot, assetPath.replace(/^assets\//u, "runtime/"));
    await write(stagePath, `fixture:${assetPath}\n`);
  }
}

async function write(path: string, value: string) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, value);
}

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "retrom-provider-release-"));
  temporaryRoots.push(root);
  return root;
}
