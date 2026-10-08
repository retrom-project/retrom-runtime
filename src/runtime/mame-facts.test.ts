import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {expect, it} from "vitest";
import type {ArcadeCatalog, ArchiveMember} from "./arcade.js";
import {contentBIOSRequirements, prepareRuntime} from "./prepare.js";

const tables: Record<string, ArcadeCatalog> = JSON.parse(gunzipSync(
  readFileSync("assets/facts/arcade-catalog.json.gz")).toString());
const catalog = tables.mame_arcade;
function request(machine: string, extra: ArchiveMember[] = []) {
  const file = {logicalKey: "game", name: `${machine}.zip`, sizeBytes: 100, sha256: "a".repeat(64)};
  return {directory: {platformId: "arcade", defaultCoreId: "mame_arcade", allowedCoreIds: ["mame_arcade"]},
    config: {content: {kind: "ARCADE", entryFile: file.logicalKey}}, files: [file],
    fingerprints: {"retrom-runtime/mame-arcade": "b".repeat(64)}, arcadeCatalog: catalog,
    archives: {[file.logicalKey]: [...catalog[machine].roms.map(rom => ({name: rom.name,
      sizeBytes: Number(rom.size), crc32: rom.crc})), ...extra]}};
}

it("prepares Renegade with the exact device firmware omitted from its game ROM list", () => {
  const input = request("renegade"), prepared = prepareRuntime(input);
  expect(prepared.dependencies.biosSets).toEqual(["m68705p5"]);
  expect(prepared.biosRequirements).toEqual([expect.objectContaining({logicalName: "m68705p5.zip", required: true,
    virtualPath: "content/roms/m68705p5.zip", members: [{name: "bootstrap.bin", sizeBytes: 115,
      crc32: "f70a8620", sha1: "c154f78c23f10bb903a531cb19e99121d5f7c19c", required: true}]})]);
  expect(contentBIOSRequirements(input).biosRequirements).toEqual(prepared.biosRequirements);
});

it("does not require another firmware archive when the game already contains the device ROM", () => {
  const input = request("renegade", [{name: "bootstrap.bin", sizeBytes: 115, crc32: "f70a8620"}]);
  expect(prepareRuntime(input).biosRequirements).toEqual([]);
  expect(contentBIOSRequirements(input).biosRequirements).toEqual([]);
});

it("declares the referenced billboard firmware once using its actual DAT requirement", () => {
  const prepared = prepareRuntime(request("vf2"));
  expect(prepared.biosRequirements.filter(item => item.logicalName === "segabill.zip")).toEqual([
    expect.objectContaining({required: true, virtualPath: "content/roms/segabill.zip",
      members: [{name: "epr-18022.ic2", sizeBytes: 65536, crc32: "0ca70f80",
        sha1: "edf5ade72d9fa2f4d5f83f9f89e6cecfadd77f56", required: true}]}),
  ]);
  expect(prepared.biosRequirements.every(item => item.logicalName.endsWith(".zip"))).toBe(true);
});
