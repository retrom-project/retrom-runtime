import {expect, it} from "vitest";
import {arcadeDependencies, type ArcadeCatalog} from "./arcade.js";
import {arcadeBIOSRequirements} from "./bios.js";
import {configureRuntime} from "./configure.js";

const rom = {name: "bootstrap.bin", size: "115", crc: "f70a8620", sha1: "a".repeat(40)};
const catalog: ArcadeCatalog = {
  renegade: {parent: null, bios: false, devices: ["cpu", "mcu"], roms: []},
  cpu: {parent: null, bios: false, device: true, roms: []},
  mcu: {parent: null, bios: false, device: true, devices: ["cpu"], roms: [rom]},
};
const config = {content: {kind: "ARCADE" as const, entryFile: "renegade.zip"}};
const file = {logicalKey: "renegade.zip", name: "renegade.zip", sizeBytes: 100, sha256: "b".repeat(64)};
it("does not offer a declared device archive as the playable entry", () => {
  const input = {platformId: "arcade", coreIds: ["mame_arcade"], files: [file,
    {...file, logicalKey: "mcu.zip", name: "mcu.zip"}], arcadeCatalogs: {mame_arcade: catalog}};
  expect(configureRuntime(input).content).toEqual(config.content);
  expect(() => configureRuntime({...input, selection: {entryFile: "mcu.zip"}})).toThrow("RUNTIME_ENTRY_MISSING");
});
it("declares only required ROM-bearing devices and retains authoritative member hashes", () => {
  const dependencies = arcadeDependencies("mame_arcade", config, [file], {[file.logicalKey]: []}, catalog);
  expect(dependencies.biosSets).toEqual(["mcu"]);
  expect(arcadeBIOSRequirements("mame_arcade", catalog, dependencies.biosSets)).toEqual([
    expect.objectContaining({logicalName: "mcu.zip", delivery: "EXTERNAL_FILE", virtualPath: "content/roms/mcu.zip",
      members: [{name: rom.name, sizeBytes: 115, crc32: rom.crc, sha1: rom.sha1, required: true}]}),
  ]);
});
it("accepts device ROMs already present in the game archive", () => {
  expect(arcadeDependencies("mame_arcade", config, [file], {[file.logicalKey]: [
    {name: rom.name, sizeBytes: 115, crc32: rom.crc},
  ]}, catalog).biosSets).toEqual([]);
});
it("rejects missing device definitions, cycles, and selecting firmware as a game", () => {
  for (const bad of [{...catalog, cpu: undefined}, {...catalog, cpu: {...catalog.cpu, devices: ["mcu"]}}]) {
    expect(() => arcadeDependencies("mame_arcade", config, [file], {[file.logicalKey]: []}, bad as ArcadeCatalog))
      .toThrow("RUNTIME_ARCADE_CATALOG_INVALID");
  }
  expect(() => arcadeDependencies("mame_arcade", {...config, cores: {mame_arcade: {options: {machine: "mcu"}}}},
    [file], {[file.logicalKey]: []}, catalog)).toThrow("RUNTIME_ARCADE_MACHINE_UNKNOWN");
});
