import {expect, it} from "vitest";
import {contentBIOSRequirements, prepareRuntime} from "./prepare.js";
import type {ArcadeCatalog, ArchiveMember} from "./arcade.js";

const code = {name: "program.bin", size: "4", crc: "01020304"};
const shared = {name: "shared.bin", size: "8", crc: "05060708"};
const bios = {name: "bios.bin", size: "2", crc: "090a0b0c"};
const catalog: ArcadeCatalog = {
  game: {parent: "parent", bios: false, roms: [code, {...shared, merge: "shared.bin"}, bios]},
  parent: {parent: "firmware", bios: false, roms: [shared, bios]},
  firmware: {parent: null, bios: true, roms: [bios]},
  other: {parent: null, bios: false, roms: [{...code, name: "other.bin", crc: "11111111"}]},
};
const cores = ["fbneo", "mame2003", "mame2003_plus", "mame_arcade"];
function request(coreId: string, members: ArchiveMember[]) {
  return {directory: {platformId: "arcade", defaultCoreId: coreId, allowedCoreIds: cores},
    config: {content: {kind: "ARCADE" as const, entryFile: "original.zip"}, cores: {[coreId]: {romSet: "game", parentFiles: ["parent.zip"]}}},
    files: ["original.zip", "parent.zip"].map(name => ({name, logicalKey: name, sizeBytes: 100, sha256: "a".repeat(64)})),
    archives: {"original.zip": members, "parent.zip": [{name: shared.name, sizeBytes: 8, crc32: shared.crc}]}, arcadeCatalog: catalog,
    fingerprints: {"emulatorjs/fbneo": "b".repeat(64), "emulatorjs/mame2003": "b".repeat(64),
      "emulatorjs/mame2003-plus": "b".repeat(64), "retrom-runtime/mame-arcade": "b".repeat(64)}};
}
it.each(cores)("reports missing game members for %s while retaining existing startup behavior", core => {
  const input = request(core, []);
  expect(contentBIOSRequirements(input)).toMatchObject({missingRomMembers: [{coreId: core, romSet: "game",
    role: "ROM", member: "program.bin", sizeBytes: 4, reason: "MISSING"}]});
  expect(contentBIOSRequirements(input).biosRequirements).toHaveLength(1);
  expect(prepareRuntime(input).dependencies.missingParents).toEqual([]);
});
it("accepts renamed exact-CRC members and keeps same-name CRC changes informational", () => {
  for (const member of [{name: "renamed.bin", sizeBytes: 4, crc32: code.crc}, {name: code.name, sizeBytes: 4, crc32: "ffffffff"}]) {
    expect(contentBIOSRequirements(request("fbneo", [member]))).toMatchObject({missingRomMembers: []});
  }
  expect(contentBIOSRequirements(request("fbneo", [{name: code.name, sizeBytes: 4, crc32: "ffffffff"}])).crcWarnings)
    .toContainEqual(expect.objectContaining({role: "ROM", member: code.name}));
});
it("distinguishes wrong size from absence and ignores optional DAT members", () => {
  const input = request("mame_arcade", [{name: code.name, sizeBytes: 5, crc32: code.crc}]);
  expect(contentBIOSRequirements(input)).toMatchObject({missingRomMembers: [expect.objectContaining({reason: "SIZE_MISMATCH"})]});
  const optionalCatalog = {...catalog, game: {...catalog.game, roms: [{...code, optional: true}]}};
  expect(contentBIOSRequirements({...input, arcadeCatalog: optionalCatalog})).toMatchObject({missingRomMembers: []});
});
it("does not require unused Parent members and excludes device firmware from game gaps", () => {
  const input = request("mame_arcade", [{name: code.name, sizeBytes: 4, crc32: code.crc}]);
  const changed = {...catalog, parent: {...catalog.parent, roms: [...catalog.parent.roms, {...code, name: "unused.bin", crc: "eeeeeeee"}]},
    game: {...catalog.game, devices: ["device"]}, device: {parent: null, device: true, bios: false, roms: [{...bios, name: "boot.bin"}]}};
  expect(contentBIOSRequirements({...input, arcadeCatalog: changed})).toMatchObject({missingRomMembers: []});
});
it("uses only the selected core's DAT choice and selected Parent archives", () => {
  const input = request("fbneo", [{name: code.name, sizeBytes: 4, crc32: code.crc}]);
  input.config.cores.mame2003 = {romSet: "other", parentFiles: []};
  expect(contentBIOSRequirements(input)).toMatchObject({missingRomMembers: []});
  expect(contentBIOSRequirements({...input, coreId: "mame2003"})).toMatchObject({missingRomMembers: [expect.objectContaining({coreId: "mame2003", romSet: "other", member: "other.bin"})]});
  expect(contentBIOSRequirements(input)).toMatchObject({missingRomMembers: []});
  const missingParent = {...input, archives: {...input.archives, "parent.zip": []}};
  expect(contentBIOSRequirements(missingParent)).toMatchObject({missingRomMembers: [expect.objectContaining({role: "PARENT", member: shared.name})]});
});
