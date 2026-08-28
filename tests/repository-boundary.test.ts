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

  it("publishes seven RPG Maker generations plus one independent ONS core", async () => {
    const manifest = JSON.parse(await readFile(join(root, "runtime-manifest.json"), "utf8"));
    expect(manifest.packageName).toBe("@xxxsen/retrom-runtime");
    expect(manifest.cores.filter((core: { family: string }) => core.family === "RPG_MAKER")
      .map((core: { generation: string }) => core.generation).sort()).toEqual([
      "RPG2000", "RPG2003", "RPGMV", "RPGMZ", "RPGVX", "RPGVXACE", "RPGXP",
    ]);
    expect(manifest.cores.filter((core: { family: string }) => core.family === "ONS")
      .map((core: { id: string }) => core.id)).toEqual(["onscripter-yuri"]);
    expect(manifest.cores.every((core: object) => !("routeKey" in core))).toBe(true);
    expect(manifest.localAssets.map((asset: { output: string }) => asset.output).sort()).toEqual([
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
      "easyrpg", "mkxp", "native", "onsyuri",
    ]);
    expect([...new Set(manifest.cores.map((core) => core.adapterId))].sort()).toEqual([
      "easyrpg-web", "mkxp-libretro-web", "native-web", "ons-yuri-web",
    ]);
    expect([...new Set(manifest.cores.map((core) => core.adapterAbi))].sort()).toEqual([
      "easyrpg-save", "mkxp-state-compact", "native-save", "ons-save",
    ]);
    expect((await readdir(join(root, "assets/runtime"))).sort()).toEqual(["mkxp", "native", "ons"]);
    for (const asset of ["assets/runtime/mkxp/position_bridge.rb", "assets/runtime/native/bridge.js"]) {
      expect(await readFile(join(root, asset), "utf8"), asset).not.toMatch(/RETROM|__retrom|-[vr][1-9]/u);
    }
  });

  it("ships the current license closure in the aggregate release", async () => {
    const script = await readFile(join(root, "scripts/build-release.mjs"), "utf8");
    expect(script).toContain('["CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]');
    expect(script).toContain('"CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "library/index.js"');
    expect(script).toContain("value.sourceBuilds.flatMap");
  });

  it("builds ONS from one fixed upstream commit with only the host checkpoint patch", async () => {
    const manifest = JSON.parse(await readFile(join(root, "runtime-manifest.json"), "utf8"));
    expect(manifest.sourceBuilds).toEqual([expect.objectContaining({
      adapterAbi: "ons-save",
      commit: "08f744b31cc1907b66a15f0402e62321a131ed81",
      id: "onsyuri",
      patch: "assets/runtime/ons/host-api.patch",
      repository: "https://github.com/YuriSizuku/OnscripterYuri",
      tag: "v0.7.7beta",
    })]);
    const patch = await readFile(join(root, "assets/runtime/ons/host-api.patch"), "utf8");
    expect(patch).toContain("onsyuri_host_save");
    expect(patch).toContain("onsyuri_host_load");
    expect(patch).toContain("onsyuri_host_set_paused");
    expect(patch).toContain("onsyuri_host_set_restore_slot");
    expect(patch).toContain("host_restore_status = loadGameForHost(slot) == 0 ? 0 : -1;");
    expect(patch).toContain("applyHostRestore();");
    expect(patch).toContain("onsyuri_host_is_ready");
    expect(patch).toContain("onsyuri_host_did_restore_fail");
    expect(patch).toContain("onsyuriHostReady");
    expect(patch).not.toMatch(/retrom|database|review|upload/iu);
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
