import {expect, it} from "vitest";
import {arcadeDependencies, type ArcadeCatalog} from "./arcade.js";
import {contentBIOSRequirements, prepareRuntime} from "./prepare.js";

const rom = {name: "parent.bin", size: "4", crc: "01020304", merge: "parent.bin"};
const firmware = {name: "bios.bin", size: "2", crc: "05060708", merge: "bios.bin"};
const catalog: ArcadeCatalog = {child: {parent: "parent", bios: false, roms: [rom, firmware]},
  parent: {parent: "firmware", bios: false, roms: [rom, firmware]}, firmware: {parent: null, bios: true, roms: [firmware]}};
const member = (rom: typeof firmware) => ({name: rom.name, sizeBytes: Number(rom.size), crc32: "ffffffff"});
const files = ["child.zip", "parent.zip"].map(name => ({logicalKey: name, name, sizeBytes: 10, sha256: "a".repeat(64)}));
const request = {directory: {platformId: "arcade", defaultCoreId: "fbneo", allowedCoreIds: ["fbneo"]},
  config: {content: {kind: "ARCADE" as const, entryFile: "child.zip"}, cores: {fbneo: {parentFiles: ["parent.zip"]}}},
  files, archives: {"child.zip": [member(firmware)], "parent.zip": [member(rom)]}, arcadeCatalog: catalog,
  fingerprints: {"emulatorjs/fbneo": "b".repeat(64)}};

it("allows named, correctly sized game/Parent/BIOS members with mismatched CRC and returns review warnings", () => {
  expect(arcadeDependencies("fbneo", request.config, files, request.archives, catalog))
    .toEqual({parentFiles: ["parent.zip"], missingParents: [], biosSets: ["firmware"]});
  const projected = contentBIOSRequirements(request);
  expect(projected.crcWarnings).toEqual(expect.arrayContaining([
    {role: "PARENT", file: "parent.zip", member: rom.name, expectedCRC32: rom.crc, actualCRC32: "ffffffff"},
    {role: "BIOS", file: "child.zip", member: firmware.name, expectedCRC32: firmware.crc, actualCRC32: "ffffffff"},
  ]));
  expect(prepareRuntime(request).crcWarnings).toEqual(projected.crcWarnings);
  expect(prepareRuntime(request).biosRequirements).toEqual([expect.objectContaining({
    requirementKey: "emulatorjs/fbneo/firmware.zip", required: true,
  })]);
});
it("does not turn a truly missing or wrong-sized game ROM into a CRC warning", () => {
  const archives = {...request.archives, "parent.zip": [{...member(rom), sizeBytes: 5}]};
  expect(() => prepareRuntime({...request, archives})).toThrow("RUNTIME_PARENT_MISSING");
});
