import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("publishes seven RPG Maker generations plus independent ONS, KiriKiri and Butterscotch cores", async () => {
    const manifest = JSON.parse(await readFile(join(root, "runtime-manifest.json"), "utf8"));
    expect(manifest.packageName).toBe("@xxxsen/retrom-runtime");
    expect(manifest.cores.filter((core: { family: string }) => core.family === "RPG_MAKER")
      .map((core: { generation: string }) => core.generation).sort()).toEqual([
      "RPG2000", "RPG2003", "RPGMV", "RPGMZ", "RPGVX", "RPGVXACE", "RPGXP",
    ]);
    expect(manifest.cores.filter((core: { family: string }) => core.family === "ONS")
      .map((core: { id: string }) => core.id)).toEqual(["onscripter-yuri"]);
    expect(manifest.cores.filter((core: { family: string }) => core.family === "KIRIKIRI")
      .map((core: { id: string }) => core.id)).toEqual(["kirikiri2-kag"]);
    expect(manifest.cores.filter((core: { family: string }) => core.family === "BUTTERSCOTCH")
      .map((core: { id: string }) => core.id)).toEqual(["butterscotch-gamemaker"]);
    expect(manifest.cores.every((core: object) => !("routeKey" in core))).toBe(true);
    expect(manifest.localAssets.map((asset: { output: string }) => asset.output).sort()).toEqual([
      "runtime/butterscotch/worker.mjs",
      "runtime/mkxp/position_bridge.rb",
      "runtime/native/bridge.js",
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(/runtime\/(?:v\d+|[^/]+-v\d+)\//u);
  });

  it("contains one clean runtime role without migration-era aliases", async () => {
    const manifest = JSON.parse(await readFile(join(root, "runtime-manifest.json"), "utf8")) as {
      cores: Array<{ adapterAbi: string; adapterId: string; runtimeId: string }>;
    };
    expect([...new Set(manifest.cores.map((core) => core.runtimeId))].sort()).toEqual([
      "butterscotch", "easyrpg", "kirikiri2", "mkxp", "native", "onsyuri",
    ]);
    expect([...new Set(manifest.cores.map((core) => core.adapterId))].sort()).toEqual([
      "butterscotch-web", "easyrpg-web", "kirikiri2-web", "mkxp-libretro-web", "native-web", "ons-yuri-web",
    ]);
    expect([...new Set(manifest.cores.map((core) => core.adapterAbi))].sort()).toEqual([
      "butterscotch-checkpoint-v2", "easyrpg-save", "kirikiri-kag-bookmark", "mkxp-state-compact",
      "native-save", "ons-save",
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

  it("aggregates every external core from a pinned fork release", async () => {
    const manifest = JSON.parse(await readFile(join(root, "runtime-manifest.json"), "utf8"));
    expect(manifest).not.toHaveProperty("sourceBuilds");
    expect(manifest.upstreamReleases).toEqual(expect.arrayContaining([expect.objectContaining({
      adapterAbi: "ons-save",
      id: "onsyuri",
      repository: "https://github.com/xxxsen/OnscripterYuri",
      tag: "rpg-runtime-0.7.7beta-r4",
    }), expect.objectContaining({
      adapterAbi: "kirikiri-kag-bookmark",
      id: "kirikiri2",
      repository: "https://github.com/xxxsen/kirikiroid2-web",
      tag: "rpg-runtime-g338d2029f169-r2",
    }), expect.objectContaining({
      adapterAbi: "butterscotch-checkpoint-v2",
      id: "butterscotch",
      repository: "https://github.com/xxxsen/Butterscotch",
      tag: "rpg-runtime-gae2602f1f83c-r3-rc.1",
    })]));
    const releaseIds = manifest.upstreamReleases.map((release: { id: string }) => release.id).sort();
    const externalRuntimeIds = [...new Set(manifest.cores
      .map((core: { runtimeId: string }) => core.runtimeId)
      .filter((runtimeId: string) => runtimeId !== "native"))].sort();
    expect(releaseIds).toEqual(externalRuntimeIds);
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
    const releaseWorkflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
    expect(releaseWorkflow).toContain('git cat-file -t "refs/tags/$GITHUB_REF_NAME"');
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
