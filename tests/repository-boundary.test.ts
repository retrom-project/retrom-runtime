import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {retromRuntimeProviderDefinition} from "../src/providers/retrom-runtime/catalog.js";

const root = process.cwd();

describe("independent package boundary", () => {
  it("does not import host-application modules", async () => {
    const files = await sourceFiles(join(root, "src"));
    for (const file of files) {
      const contents = await readFile(file, "utf8");
      expect(contents, file).not.toMatch(/from\s+["']@\//u);
      expect(contents, file).not.toContain("features/player/rpg-validation-protocol");
      expect(contents, file).not.toContain("lib/api/generated");
    }
  });

  it("publishes seven RPG Maker targets plus independent ONS, KiriKiri, Butterscotch, TyranoScript and WASM-4 targets", async () => {
    const sources = JSON.parse(await readFile(join(root, "provider-sources.json"), "utf8"));
    expect(retromRuntimeProviderDefinition.providerId).toBe("retrom-runtime");
    expect(retromRuntimeProviderDefinition.targets.map((target) => target.id)).toEqual([
      "butterscotch-gamemaker", "kirikiri2-kag", "onscripter-yuri", "rpgmaker-2000", "rpgmaker-2003",
      "rpgmaker-mv", "rpgmaker-mz", "rpgmaker-vx", "rpgmaker-vx-ace", "rpgmaker-xp", "tyranoscript", "wasm4",
    ]);
    expect(sources.localAssets.map((asset: { output: string }) => asset.output).sort()).toEqual([
      "runtime/butterscotch/worker.mjs",
      "runtime/mkxp/position_bridge.rb",
      "runtime/native/bridge.js",
    ]);
    expect(JSON.stringify(sources)).not.toMatch(/runtime\/(?:v\d+|[^/]+-v\d+)\//u);
  });

  it("contains one clean Provider-private adapter role without migration-era aliases", async () => {
    expect(retromRuntimeProviderDefinition.adapters.map((adapter) => adapter.id).sort()).toEqual([
      "butterscotch-web", "easyrpg-web", "kirikiri2-web", "mkxp-libretro-web", "native-web", "ons-yuri-web",
      "tyranoscript-web", "wasm4-web",
    ]);
    expect(retromRuntimeProviderDefinition.adapters.map((adapter) => adapter.abi).sort()).toEqual([
      "butterscotch-checkpoint-v2", "easyrpg-save", "kirikiri-kag-bookmark", "mkxp-state-compact",
      "native-save", "ons-save", "tyranoscript-snapshot-v1", "wasm4-state-v1",
    ]);
    expect((await readdir(join(root, "assets/runtime"))).sort()).toEqual(["butterscotch", "mkxp", "native"]);
    for (const asset of [
      "assets/runtime/butterscotch/worker.mjs", "assets/runtime/mkxp/position_bridge.rb",
      "assets/runtime/native/bridge.js",
    ]) {
      expect(await readFile(join(root, asset), "utf8"), asset).not.toMatch(/RETROM|__retrom|-[vr][1-9]/u);
    }
  });

  it("ships the current license closure in the aggregate release", async () => {
    const script = await readFile(join(root, "scripts/build-release.mjs"), "utf8");
    expect(script).toContain('["CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]');
    expect(script).toContain('"CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "library/index.js"');
    expect(script).toContain("await rm(stage, { recursive: true, force: true })");
    expect(script).not.toContain("sourceBuilds");
  });

  it("builds and verifies the Provider bundle from the already materialized release stage", async () => {
    const release = await readFile(join(root, "scripts/build-release.mjs"), "utf8");
    const candidate = await readFile(join(root, "scripts/build-candidate.mjs"), "utf8");
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(release).toContain("buildCurrentProviderBuild");
    expect(release.lastIndexOf("buildCurrentProviderBuild"))
      .toBeGreaterThan(release.lastIndexOf("for (const release of sources.upstreamReleases)"));
    expect(release).toContain("pinCurrentProviderRelease");
    expect(packageJson.scripts["provider:build"].split(" && ")).toEqual([
      "npm run build",
      "npm run provider:input:prepare",
      "RETROM_PROVIDER_BUILD_ONLY=1 node scripts/build-release.mjs",
    ]);
    expect(release).toContain('const requestedBuildMode = process.env.RETROM_PROVIDER_BUILD_MODE ?? "candidate"');
    expect(packageJson.scripts["provider:check"].split(" && ")).toEqual([
      "npm run provider:input:check",
      "node scripts/provider-release.mjs check",
    ]);
    expect(candidate).toContain('join(root, "release", "providers")');
    expect(candidate).not.toContain("provider-release.json");
    expect(candidate).not.toContain(".retrom-pfb-candidate.json");
    expect(candidate).not.toContain('"data", "dat", "rpgmaker"');
    expect(candidate).not.toContain('join(root, "release", "stage")');
  });

  it("aggregates every external core from a pinned fork release", async () => {
    const sources = JSON.parse(await readFile(join(root, "provider-sources.json"), "utf8"));
    expect(sources).not.toHaveProperty("sourceBuilds");
    expect(sources.upstreamReleases).toEqual(expect.arrayContaining([expect.objectContaining({
      adapterAbi: "ons-save",
      id: "onsyuri",
      repository: "https://github.com/retrom-project/OnscripterYuri",
      tag: "retrom-core-0.7.7beta-r4",
    }), expect.objectContaining({
      adapterAbi: "kirikiri-kag-bookmark",
      id: "kirikiri2",
      repository: "https://github.com/retrom-project/kirikiroid2-web",
      tag: "retrom-core-g338d2029f169-r2",
    }), expect.objectContaining({
      adapterAbi: "butterscotch-checkpoint-v2",
      id: "butterscotch",
      repository: "https://github.com/retrom-project/Butterscotch",
      tag: "retrom-core-gae2602f1f83c-r4",
    }), expect.objectContaining({
      adapterAbi: "tyranoscript-snapshot-v1",
      id: "tyranoscript",
      repository: "https://github.com/retrom-project/tyranoscript",
      tag: "retrom-core-gc8dbfd492afd-r5",
    }), expect.objectContaining({
      adapterAbi: "wasm4-state-v1",
      id: "wasm4",
      repository: "https://github.com/retrom-project/wasm4",
      tag: "retrom-core-gca2600db8de4-r1",
    })]));
    const releaseIds = sources.upstreamReleases.map((release: { id: string }) => release.id).sort();
    expect(releaseIds).toEqual(["butterscotch", "easyrpg", "kirikiri2", "mkxp", "onsyuri", "tyranoscript", "wasm4"]);
    expect(await readdir(join(root, "scripts"))).not.toEqual(expect.arrayContaining([
      "build-kirikiri-core.sh", "build-ons-core.sh",
    ]));
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    expect(Object.keys(packageJson.scripts)).not.toEqual(expect.arrayContaining([
      "core:kirikiri:build", "core:ons:build",
    ]));
    for (const workflow of ["quality.yml", "release.yml"]) {
      const contents = await readFile(join(root, ".github/workflows", workflow), "utf8");
      expect(contents).not.toMatch(/core:(?:ons|kirikiri)|build-(?:ons|kirikiri)-core/u);
    }
    const quality = await readFile(join(root, ".github/workflows/quality.yml"), "utf8");
    expect(quality).toContain("npm run release:build");
    expect(quality).toContain("RETROM_PROVIDER_BUILD_MODE: candidate");
    const releaseWorkflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
    expect(releaseWorkflow).toContain('git cat-file -t "refs/tags/$GITHUB_REF_NAME"');
    expect(releaseWorkflow).toContain("RETROM_PROVIDER_BUILD_MODE: release");
    const instructions = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(instructions).toContain("不得编译第三方核心");
    expect(instructions).toContain("只聚合");
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {return sourceFiles(path);}
    return extname(entry.name) === ".ts" && !entry.name.endsWith(".test.ts") ? [path] : [];
  }));
  return paths.flat();
}
