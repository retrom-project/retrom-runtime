import {expect, it} from "vitest";
import {configureRuntime} from "./configure.js";
import {prepareRuntime} from "./prepare.js";
import {runtimeCatalog} from "./catalog.js";

const file = {logicalKey: "wldrider.zip", name: "wldrider.zip", sha256: "a".repeat(64), sizeBytes: 100};
const member = {name: "game.ic1", sizeBytes: 100, crc32: "01020304"};
const machine = {name: "wldrider", parent: null, platform: "naomi2", mediaType: "CARTRIDGE", disc: null,
  files: [{...member, optional: false}, {name: "default-eeprom", sizeBytes: 128, crc32: null, optional: true}]};
const request = {directory: {platformId: "naomi2", defaultCoreId: "flycast-naomi2", allowedCoreIds: ["flycast-naomi2"]},
  config: {content: {kind: "SINGLE_FILE", entryFile: file.logicalKey}}, files: [file],
  fingerprints: {"emulatorjs/flycast-naomi2": "b".repeat(64)}, archives: {[file.logicalKey]: [member]}, flycastCatalog: [machine]};

it.each(["naomi", "naomi2", "atomiswave"])("configures %s cartridge ZIPs as one opaque game resource", platformId => {
  const coreId = `flycast-${platformId}`;
  expect(configureRuntime({platformId, coreIds: [coreId], files: [file]}).content)
    .toEqual({kind: "SINGLE_FILE", entryFile: file.logicalKey});
  expect(runtimeCatalog().bindings.find(binding => binding.coreId === coreId)).toMatchObject({archiveExtensions: ["zip"]});
});
it("requires the current compiled ROM catalog and checks required game members before preparing a launch", () => {
  expect(prepareRuntime(request).resources[0]).toMatchObject({kind: "SEEKABLE_BLOB", files: [file.logicalKey]});
  expect(() => prepareRuntime({...request, flycastCatalog: undefined})).toThrow("RUNTIME_FLYCAST_CATALOG_UNAVAILABLE");
  for (const members of [[], [{...member, sizeBytes: 101}]]) {
    expect(() => prepareRuntime({...request, archives: {[file.logicalKey]: members}})).toThrow("RUNTIME_FLYCAST_ROM_MISSING");
  }
});
it("does not accept unknown machines, wrong hardware, or unsupported GD-ROM/CF media", () => {
  expect(() => prepareRuntime({...request, flycastCatalog: []})).toThrow("RUNTIME_FLYCAST_MACHINE_UNKNOWN");
  expect(() => prepareRuntime({...request, flycastCatalog: [{...machine, platform: "naomi"}]})).toThrow("RUNTIME_FLYCAST_PLATFORM_MISMATCH");
  for (const mediaType of ["GDROM", "COMPACT_FLASH"]) {
    expect(() => prepareRuntime({...request, flycastCatalog: [{...machine, mediaType}]})).toThrow("RUNTIME_FLYCAST_MEDIA_UNSUPPORTED");
  }
});
it("allows a complete clone archive and refuses a split clone needing an unavailable external Parent", () => {
  const clone = {...machine, parent: "parent"};
  expect(prepareRuntime({...request, flycastCatalog: [clone]}).dependencies.missingParents).toEqual([]);
  expect(() => prepareRuntime({...request, flycastCatalog: [clone], archives: {[file.logicalKey]: []}}))
    .toThrow("RUNTIME_FLYCAST_ROM_MISSING");
});

it("reports modified cartridge CRC as a review warning while permitting preparation", () => {
  const modified = {...request, archives: {[file.logicalKey]: [{...member, crc32: "ffffffff"}]}};
  expect(prepareRuntime(modified).crcWarnings).toEqual([{role: "ROM", file: file.logicalKey, member: member.name,
    expectedCRC32: member.crc32, actualCRC32: "ffffffff"}]);
});
