import {expect, it} from "vitest";
import {configureRuntime} from "./configure.js";
import {validateConfigurationFiles} from "./configuration.js";
import {inspectRuntimeIdentity, prepareRuntime, contentBIOSRequirements} from "./prepare.js";
import type {RPGEngine, RuntimeContentFile} from "./types.js";

const file = (logicalKey: string): RuntimeContentFile => ({logicalKey, name: logicalKey, sizeBytes: 128, sha256: "a".repeat(64)});
const config = (engine: RPGEngine, entryFile: string) => ({content: {kind: "RPG_MAKER_PROJECT" as const, engine, entryFile}});
const files = ["www/index.html", "www/js/rpg_core.js", "www/js/rmmz_core.js", "www/Game.ini", "www/RPG_RT.ldb",
  "www/data/System.json", "www/img/Title.png", "www/start.html", "docs/index.html"].map(file);

it.each<[RPGEngine, string]>([
  ["RPGMV", "www/index.html"], ["RPGMZ", "www/index.html"], ["RPGXP", "www/Game.ini"],
  ["RPGVX", "www/Game.ini"], ["RPGVXACE", "www/Game.ini"], ["RPG2000", "www/RPG_RT.ldb"], ["RPG2003", "www/RPG_RT.ldb"],
])("restricts %s to its entry file while preserving directories", (engine, entry) => {
  expect(() => validateConfigurationFiles(config(engine, entry), files)).not.toThrow();
  for (const wrong of files.filter(item => item.logicalKey !== entry)) {
    expect(() => validateConfigurationFiles(config(engine, wrong.logicalKey), files)).toThrow("RUNTIME_RPG_ENTRY_INVALID");
  }
});

it("rejects an invalid RPG entry at identity, launch and review boundaries", () => {
  const request = {directory: {platformId: "rpgmaker", defaultCoreId: "rpgmaker", allowedCoreIds: ["rpgmaker"]},
    files, config: config("RPGMV", "www/data/System.json"), fingerprints: {"retrom-runtime/rpgmaker-mv": "b".repeat(64)}};
  for (const inspect of [inspectRuntimeIdentity, prepareRuntime, contentBIOSRequirements]) {
    expect(() => inspect(request)).toThrow("RUNTIME_RPG_ENTRY_INVALID");
  }
});

it("ignores unrelated index pages and identifies the entry beside the engine", () => {
  expect(configureRuntime({platformId: "rpgmaker", coreIds: ["rpgmaker"],
    files: ["docs/index.html", "www/index.html", "www/js/rpg_core.js"].map(file)}).content)
    .toEqual(config("RPGMV", "www/index.html").content);
});

it.each(["rpg_core.js", "rmmz_core.js"])("defaults same-engine %s projects to the root index while retaining explicit choices", script => {
  const input = {platformId: "rpgmaker", coreIds: ["rpgmaker"],
    files: ["index.html", `js/${script}`, "www/index.html", `www/js/${script}`, "docs/index.html"].map(file)};
  expect(configureRuntime(input).content).toMatchObject({entryFile: "index.html"});
  expect(configureRuntime({...input, selection: {entryFile: "www/index.html"}}).content)
    .toMatchObject({entryFile: "www/index.html"});
  expect(() => configureRuntime({...input, files: input.files.map(item => file(`nested/${item.logicalKey}`))}))
    .toThrow("RUNTIME_ENTRY_REQUIRED");
  expect(() => configureRuntime({...input, files: [...input.files, file("INDEX.HTML")]}))
    .toThrow("RUNTIME_ENTRY_REQUIRED");
});

it("resolves mixed-engine projects only through an explicit valid entry", () => {
  const input = {platformId: "rpgmaker", coreIds: ["rpgmaker"],
    files: ["index.html", "js/rmmz_core.js", "www/index.html", "www/js/rpg_core.js", "docs/index.html"].map(file)};
  expect(() => configureRuntime(input)).toThrow("RUNTIME_ENTRY_REQUIRED");
  expect(configureRuntime({...input, selection: {entryFile: "www/index.html"}}).content)
    .toEqual(config("RPGMV", "www/index.html").content);
  expect(() => configureRuntime({...input, selection: {entryFile: "docs/index.html"}})).toThrow("RUNTIME_RPG_ENTRY_INVALID");
});
it.each(["RPGMV", "RPGMZ"] as const)("scopes %s plugin resources to the selected project without exposing desktop binaries", engine => {
  const files = ["Game/www/index.html", `Game/www/js/${engine === 'RPGMV' ? 'rpg_core' : 'rmmz_core'}.js`,
    "Game/scenario/En/001.sl", "Game/scenario/CG.txt", "Game/scenario/movie.ogg", "Game/Game.exe",
    "Other/scenario/En/001.sl", "Game/readme.txt"].map(file);
  const request = {directory: {platformId: "rpgmaker", defaultCoreId: "rpgmaker", allowedCoreIds: ["rpgmaker"]},
    files, config: config(engine, "Game/www/index.html"),
    fingerprints: {[`retrom-runtime/rpgmaker-${engine === 'RPGMV' ? 'mv' : 'mz'}`]: "b".repeat(64)}};
  const game = prepareRuntime(request).resources.find(resource => resource.role === "game")!;
  expect(game.files).toEqual(engine === "RPGMV" ? files.slice(0, 4).map(file => file.logicalKey) : files.slice(0, 2).map(file => file.logicalKey));
});
