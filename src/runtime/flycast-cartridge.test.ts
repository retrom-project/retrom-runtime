import {expect, it} from "vitest";
import {configureRuntime} from "./configure.js";
import {prepareRuntime} from "./prepare.js";
import {runtimeCatalog} from "./catalog.js";
import {arcadeParentOptions} from "./arcade-parent.js";
import {flycastContentReferences, flycastMedia} from "./flycast-arcade.js";
import {reconcileArcadeConfiguration} from "./rom-set.js";

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
it("does not accept unknown machines, wrong hardware, or unsupported CF media", () => {
  expect(() => prepareRuntime({...request, flycastCatalog: []})).toThrow("RUNTIME_FLYCAST_MACHINE_UNKNOWN");
  expect(() => prepareRuntime({...request, flycastCatalog: [{...machine, platform: "naomi"}]})).toThrow("RUNTIME_FLYCAST_PLATFORM_MISMATCH");
  for (const mediaType of ["COMPACT_FLASH"]) {
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

it("delivers a GD-ROM ZIP and its catalog-declared CHD as one game's original files", () => {
  const disc = {...file, logicalKey: "wldrider/disc-image.chd", name: "wldrider/disc-image.chd", sizeBytes: 4096};
  const result = prepareRuntime({...request, files: [file, disc],
    flycastCatalog: [{...machine, mediaType: "GDROM", disc: "disc-image"}]});
  expect(result.resources).toEqual([
    {role: "game", kind: "SEEKABLE_BLOB", ordinal: 0, files: [file.logicalKey], entryFile: file.logicalKey},
    {role: "game-files", kind: "EXTERNAL_FILE_SET", ordinal: 0, files: [disc.logicalKey],
      paths: {[disc.logicalKey]: "wldrider/disc-image.chd"}},
  ]);
});

it("discovers only the selected machine's safe disc and missing Parent references", () => {
  const gdrom = {...machine, parent: "parent", mediaType: "GDROM", disc: "disc-image"};
  const references = flycastContentReferences(gdrom, file, [], [gdrom, {...machine, name: "parent"}]);
  expect(references.map(reference => reference.relativePath)).toEqual(["wldrider/disc-image.chd", "parent/disc-image.chd", "parent.zip"]);
  expect(references.every(reference => reference.optional && reference.relativeTo === file.logicalKey)).toBe(true);
  expect(flycastContentReferences(gdrom, file, [member], [gdrom, {...machine, name: "parent"}]))
    .not.toContainEqual(expect.objectContaining({relativePath: "parent.zip"}));
});

it("rejects ambiguous loose discs while preferring the catalog's exact path", () => {
  const gdrom = {...machine, mediaType: "GDROM", disc: "disc-image"};
  const discs = ["a/disc-image.chd", "b/disc-image.chd"].map(name => ({...file, name, logicalKey: name}));
  expect(() => flycastMedia(gdrom, file, discs)).toThrow("RUNTIME_FLYCAST_DISC_AMBIGUOUS");
  const exact = {...file, name: "wldrider/disc-image.chd", logicalKey: "wldrider/disc-image.chd"};
  expect(flycastMedia(gdrom, file, [...discs, exact]).mediaFiles).toEqual([exact.logicalKey]);
});

it("retires an obsolete Parent after a cartridge entry change", () => {
  const parent = {...file, name: "parent.zip", logicalKey: "parent.zip"};
  const replacement = {...file, name: "replacement.zip", logicalKey: "replacement.zip"};
  const previousConfig = {...request.config, cores: {"flycast-naomi2": {parentFiles: [parent.logicalKey]}}};
  const result = reconcileArcadeConfiguration({...request, files: [file, parent, replacement], previousConfig,
    config: {...previousConfig, content: {...request.config.content, entryFile: replacement.logicalKey}}, arcadeCatalogs: {},
    flycastCatalogs: {"flycast-naomi2": [machine, {...machine, name: "replacement"}]}});
  expect(result.removedParentFiles).toEqual([parent.logicalKey]);
  expect(result.config.cores?.["flycast-naomi2"].parentFiles).toEqual([]);
});

it("selects the ZIP entry when a GD-ROM CHD and named Parent are also present", () => {
  const parent = {...file, logicalKey: "parent.zip", name: "parent.zip"};
  const disc = {...file, logicalKey: "wldrider/disc-image.chd", name: "wldrider/disc-image.chd"};
  expect(configureRuntime({platformId: "naomi2", coreIds: ["flycast-naomi2"], files: [file, disc],
    selection: {entryFile: file.logicalKey}}).content).toMatchObject({entryFile: file.logicalKey});
  const result = prepareRuntime({...request, files: [file, parent],
    config: {...request.config, cores: {"flycast-naomi2": {parentFiles: [parent.logicalKey]}}},
    archives: {[file.logicalKey]: [], [parent.logicalKey]: [member]},
    flycastCatalog: [{...machine, parent: "parent"}, {...machine, name: "parent"}]});
  expect(result.dependencies.parentFiles).toEqual([parent.logicalKey]);
  expect(result.resources[1]).toMatchObject({role: "game-files", kind: "EXTERNAL_FILE_SET", files: [parent.logicalKey],
    paths: {[parent.logicalKey]: "parent.zip"}});
});

it("reports a missing disc distinctly from BIOS and a missing Parent", () => {
  expect(() => prepareRuntime({...request, flycastCatalog: [{...machine, mediaType: "GDROM", disc: "disc-image"}]}))
    .toThrow("RUNTIME_FLYCAST_DISC_MISSING");
  expect(arcadeParentOptions({...request, flycastCatalog: [{...machine, mediaType: "GDROM", disc: "disc-image"}]}))
    .toMatchObject({missingMedia: ["wldrider/disc-image.chd"], mediaFiles: [], missingParents: []});
});

it("mounts case-insensitive Parent names under the compiled driver's canonical name", () => {
  const parent = {...file, logicalKey: "PARENT.ZIP", name: "PARENT.ZIP"};
  const result = prepareRuntime({...request, files: [file, parent],
    config: {...request.config, cores: {"flycast-naomi2": {parentFiles: [parent.logicalKey]}}},
    archives: {[file.logicalKey]: [], [parent.logicalKey]: [member]},
    flycastCatalog: [{...machine, parent: "parent"}, {...machine, name: "parent"}]});
  expect(result.resources[1]).toMatchObject({paths: {[parent.logicalKey]: "parent.zip"}});
});

it("uses parent member evidence and leaves CRC differences as Parent review warnings", () => {
  const parent = {...file, logicalKey: "parent.zip", name: "parent.zip"};
  const result = prepareRuntime({...request, files: [file, parent],
    config: {...request.config, cores: {"flycast-naomi2": {parentFiles: [parent.logicalKey]}}},
    archives: {[file.logicalKey]: [], [parent.logicalKey]: [{...member, crc32: "ffffffff"}]},
    flycastCatalog: [{...machine, parent: "parent"}, {...machine, name: "parent"}]});
  expect(result.crcWarnings).toEqual([{role: "PARENT", file: parent.logicalKey, member: member.name,
    expectedCRC32: member.crc32, actualCRC32: "ffffffff"}]);
});

it("attaches only catalog-declared media and Parent to the selected core", () => {
  const parent = {...file, logicalKey: "parent.zip", name: "parent.zip"};
  const input = {...request, files: [file, parent], archives: {[file.logicalKey]: [], [parent.logicalKey]: [member]},
    flycastCatalog: [{...machine, parent: "parent"}, {...machine, name: "parent"}]};
  const result = arcadeParentOptions({...input, attachFile: parent.logicalKey});
  expect(result.config.cores?.["flycast-naomi2"]?.parentFiles).toEqual([parent.logicalKey]);
  expect(result.missingParents).toEqual([]);
  expect(() => arcadeParentOptions({...input, attachFile: file.logicalKey})).toThrow("RUNTIME_PARENT_INVALID");
});
