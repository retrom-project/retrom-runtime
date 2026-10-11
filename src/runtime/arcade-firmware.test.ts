import {expect, it} from "vitest";
import {arcadeDependencies, type ArcadeCatalog} from "./arcade.js";
import {arcadeParentOptions} from "./arcade-parent.js";

const payload = {name: "parent.bin", size: "1", crc: "01020304"};
const firmware = {name: "bios.bin", size: "2", crc: "05060708"};
const member = (rom: typeof payload) => ({name: rom.name, sizeBytes: Number(rom.size), crc32: rom.crc});
const file = (name: string) => ({logicalKey: name, name, sizeBytes: 1, sha256: "a".repeat(64)});
const catalog: ArcadeCatalog = {
  child: {parent: "parent", bios: false, roms: [{...payload, merge: payload.name}, {...firmware, merge: firmware.name}]},
  parent: {parent: "firmware", bios: false, roms: [payload, {...firmware, merge: firmware.name}]},
  firmware: {parent: null, bios: true, roms: [firmware]},
};
const config = {content: {kind: "ARCADE" as const, entryFile: "child.zip"}, cores: {fbneo: {parentFiles: ["parent.zip"]}}};
const files = [file("child.zip"), file("parent.zip")];
const archives = {"child.zip": [], "parent.zip": [member(payload)]};

it("resolves a game Parent without copying separately required BIOS members into it", () => {
  expect(arcadeDependencies("fbneo", config, files, archives, catalog))
    .toEqual({parentFiles: ["parent.zip"], missingParents: [], biosSets: ["firmware"]});
  expect(arcadeParentOptions({directory: {platformId: "arcade", defaultCoreId: "fbneo", allowedCoreIds: ["fbneo"]},
    config, files, archives, arcadeCatalog: catalog})).toMatchObject({parentFiles: ["parent.zip"], missingParents: []});
});
it("still requires real parent game ROMs with matching size", () => {
  for (const members of [[], [{...member(payload), sizeBytes: 10}]]) {
    expect(arcadeDependencies("fbneo", config, files, {...archives, "parent.zip": members}, catalog))
      .toMatchObject({missingParents: ["parent"], biosSets: ["firmware"]});
  }
});
it("does not confuse an unrelated firmware CRC or another member name with parent game ownership", () => {
  const unrelated = {...catalog, firmware: {...catalog.firmware, roms: [{...payload, name: "different-bios.bin"}]},
    unrelated: {parent: null, bios: true, roms: [payload]}};
  expect(arcadeDependencies("fbneo", config, files, {"child.zip": [], "parent.zip": []}, unrelated))
    .toMatchObject({missingParents: ["parent"]});
});
it("separates device firmware inherited through a normal game parent", () => {
  const devices: ArcadeCatalog = {...catalog,
    parent: {...catalog.parent, parent: null, devices: ["device"]},
    device: {parent: null, bios: false, device: true, roms: [firmware]},
  };
  const mame = {...config, cores: {mame_arcade: {parentFiles: ["parent.zip"]}}};
  expect(arcadeDependencies("mame_arcade", mame, files, archives, devices))
    .toEqual({parentFiles: ["parent.zip"], missingParents: [], biosSets: ["device"]});
  expect(arcadeDependencies("fbneo", config, files, archives, devices))
    .toEqual({parentFiles: ["parent.zip"], missingParents: [], biosSets: ["device"]});
});
it("preserves merged game payload handling and the pinned CPS2 physical Parent requirement", () => {
  const complete = {...archives, "child.zip": [member(payload)]};
  expect(arcadeDependencies("fbneo", config, files, complete, catalog))
    .toMatchObject({parentFiles: [], missingParents: [], biosSets: ["firmware"]});
  const cps2 = {...config, cores: {fbalpha2012_cps2: {parentFiles: ["parent.zip"]}}};
  expect(arcadeDependencies("fbalpha2012_cps2", cps2, files, complete, catalog))
    .toMatchObject({parentFiles: ["parent.zip"], missingParents: []});
  expect(arcadeDependencies("fbalpha2012_cps2", cps2, [files[0]], complete, catalog))
    .toMatchObject({missingParents: ["parent"]});
});
