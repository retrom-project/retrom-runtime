import {expect, it} from "vitest";
import {contentBIOSRequirements, prepareRuntime} from "./prepare.js";

const file = (name: string) => ({logicalKey: name, name, sha256: "a".repeat(64), sizeBytes: 1});
it("checks BIOS while a configured clone Parent is absent and leaves full launch validation intact", () => {
  const request = {directory: {platformId: "arcade", defaultCoreId: "fbneo", allowedCoreIds: ["fbneo"]},
    config: {content: {kind: "ARCADE", entryFile: "clone.zip"}, cores: {fbneo: {parentFiles: ["base.zip"]}}},
    files: [file("clone.zip")], archives: {"clone.zip": []},
    arcadeCatalog: {clone: {parent: "base", bios: false, roms: [{name: "game.bin", size: "1", crc: "12345678", merge: "game.bin"}]},
      base: {parent: "firmware", bios: false, roms: [{name: "game.bin", size: "1", crc: "12345678"}]},
      firmware: {parent: null, bios: true, roms: [{name: "bios.bin", size: "2", crc: "87654321"}]}},
  };
  expect(contentBIOSRequirements(request)).toMatchObject({biosRequirements: [expect.objectContaining({
    requirementKey: "emulatorjs/fbneo/firmware.zip", required: true,
    members: [{name: "bios.bin", sizeBytes: 2, crc32: "87654321", sha1: "", required: true}],
  })]});
  expect(() => prepareRuntime({...request, fingerprints: {"emulatorjs/fbneo": "b".repeat(64)}}))
    .toThrow("RUNTIME_PARENT_MISSING");
});
it("retains optional BIOS and marks unknown PSX regions optional without a guessed region", () => {
  const request = {directory: {platformId: "psx", defaultCoreId: "mednafen_psx_hw", allowedCoreIds: ["mednafen_psx_hw"]},
    config: {content: {kind: "SINGLE_FILE", entryFile: "disc.chd"}}, files: [file("disc.chd")],
    firmwareEvidence: {psxRegion: null}};
  const requirements = contentBIOSRequirements(request).biosRequirements;
  expect(requirements.map(item => item.condition).sort()).toEqual(["PSX_REGION_EU", "PSX_REGION_JP", "PSX_REGION_US"]);
  expect(requirements.every(item => !item.required)).toBe(true);
  const optional = contentBIOSRequirements({directory: {platformId: "atari7800", defaultCoreId: "prosystem", allowedCoreIds: ["prosystem"]},
    config: {content: {kind: "SINGLE_FILE", entryFile: "game.a78"}}, files: [file("game.a78")]}).biosRequirements;
  expect(optional).toEqual([expect.objectContaining({required: false})]);
});
it("uses the default allowed core and rejects unavailable selections without requiring fingerprints", () => {
  const request = {directory: {platformId: "nes", defaultCoreId: "fceumm", allowedCoreIds: ["fceumm"]},
    config: {content: {kind: "SINGLE_FILE", entryFile: "game.fds"}}, files: [file("game.fds")]};
  expect(contentBIOSRequirements(request).biosRequirements).toEqual([expect.objectContaining({coreId: "fceumm", required: true})]);
  expect(() => contentBIOSRequirements({...request, coreId: "nestopia"})).toThrow("RUNTIME_CORE_UNAVAILABLE");
  expect(() => contentBIOSRequirements({...request, files: [file("different.fds")]})).toThrow("RUNTIME_ENTRY_MISSING");
});

it.each(["fbneo", "mame_arcade"])("prepares independent DAT BIOS and keeps embedded CRC warnings for %s", coreId => {
  const rom = {name: "bios.bin", size: "2", crc: "87654321"};
  const request = {directory: {platformId: "arcade", defaultCoreId: coreId, allowedCoreIds: [coreId]},
    config: {content: {kind: "ARCADE", entryFile: "game.zip"}}, files: [file("game.zip")],
    arcadeCatalog: {game: {parent: "firmware", bios: false, roms: [rom]},
      firmware: {parent: null, bios: true, roms: [rom]}},
    fingerprints: {[coreId === "fbneo" ? "emulatorjs/fbneo" : "retrom-runtime/mame-arcade"]: "b".repeat(64)},
  };
  for (const crc32 of [rom.crc, "ffffffff"]) {
    const input = {...request, archives: {"game.zip": [{name: rom.name, sizeBytes: 2, crc32}]}};
    const projected = contentBIOSRequirements(input), prepared = prepareRuntime(input);
    expect(projected.biosRequirements).toEqual([expect.objectContaining({
      coreId, logicalName: "firmware.zip", required: true, delivery: "EXTERNAL_FILE",
    })]);
    expect(prepared.biosRequirements).toEqual(projected.biosRequirements);
    expect(prepared.resources).toEqual([expect.objectContaining({role: "game", entryFile: "game.zip"})]);
    expect(prepared.crcWarnings).toEqual(projected.crcWarnings);
    expect(projected.crcWarnings).toHaveLength(crc32 === rom.crc ? 0 : 1);
  }
});
