import {expect, it} from "vitest";
import {prepareRuntime, contentBIOSRequirements, arcadeParentOptions} from "../src/runtime/index.js";
import {arcadeDiskRequirements} from "../src/runtime/arcade-media.js";
const hash = "a".repeat(40);
const zip = {name: "sample.zip", logicalKey: "sample.zip", sizeBytes: 22, sha256: "1".repeat(64)};
const disc = {name: "renamed.chd", logicalKey: "other/renamed.chd", sizeBytes: 1024, sha256: "2".repeat(64)};
const request = {directory: {platformId: "arcade", defaultCoreId: "mame_arcade", allowedCoreIds: ["mame_arcade"]},
  config: {content: {kind: "ARCADE", entryFile: zip.logicalKey}}, files: [zip],
  fingerprints: {"retrom-runtime/mame-arcade": "3".repeat(64)}, archives: {[zip.logicalKey]: []},
  arcadeCatalog: {sample: {parent: null, bios: false, roms: [], disks: [{name: "disk", sha1: hash, region: "disk", index: "0", writable: false}]}}};
it("reports a required MAME disk before a launch can be prepared", () => {
  expect(() => prepareRuntime(request)).toThrow("RUNTIME_ARCADE_DISK_MISSING");
  expect(() => contentBIOSRequirements(request)).toThrow("RUNTIME_ARCADE_DISK_MISSING");
  expect(arcadeParentOptions(request)).toMatchObject({mediaFiles: [], missingMedia: ["sample/disk.chd"]});
});
it("uses disk identity rather than a source filename and delivers the DAT path", () => {
  const input = {...request, files: [zip, disc], chdHeaders: {[disc.logicalKey]: {sha1: hash, parentSHA1: null}}};
  const prepared = prepareRuntime(input);
  expect(prepared.resources).toContainEqual({role: "media", kind: "EXTERNAL_FILE_SET", ordinal: 0,
    files: [disc.logicalKey], paths: {[disc.logicalKey]: "sample/disk.chd"}});
  expect(arcadeParentOptions({...input, attachFile: disc.logicalKey})).toMatchObject({mediaFiles: [disc.logicalKey], missingMedia: [], config: request.config});
  expect(() => prepareRuntime({...input, chdHeaders: {[disc.logicalKey]: {sha1: "b".repeat(40), parentSHA1: null}}}))
    .toThrow("RUNTIME_ARCADE_DISK_MISSING");
});
it("keeps ordinary ROM-only games independent of disk evidence", () => {
  expect(prepareRuntime({...request, arcadeCatalog: {sample: {...request.arcadeCatalog.sample, disks: []}}}).resources)
    .toEqual([{role: "game", kind: "ROM_BLOB", ordinal: 0, files: [zip.logicalKey], entryFile: zip.logicalKey}]);
});
it("inherits clone disks under the selected set and reports each required disk independently", () => {
  const disk = request.arcadeCatalog.sample.disks[0];
  const catalog = {...request.arcadeCatalog, clone: {parent: "sample", bios: false, roms: []}};
  expect(arcadeDiskRequirements("clone", catalog)).toEqual([{path: "clone/disk.chd", disk}]);
  const input = {...request, files: [zip, disc], chdHeaders: {[disc.logicalKey]: {sha1: hash, parentSHA1: null}},
    arcadeCatalog: {sample: {...request.arcadeCatalog.sample, disks: [disk,
      {...disk, name: "second", sha1: "b".repeat(40)}, {...disk, name: "optional", sha1: "c".repeat(40), optional: true}]}}};
  expect(arcadeParentOptions(input)).toMatchObject({mediaFiles: [disc.logicalKey], missingMedia: ["sample/second.chd"]});
});
it("prefers a complete image over a differential candidate with the same DAT identity", () => {
  const differential = {...disc, name: "disk.chd", logicalKey: "sample/disk.chd"};
  const input = {...request, files: [zip, differential, disc], chdHeaders: {
    [differential.logicalKey]: {sha1: hash, parentSHA1: "b".repeat(40)}, [disc.logicalKey]: {sha1: hash, parentSHA1: null},
  }};
  expect(arcadeParentOptions(input)).toMatchObject({mediaFiles: [disc.logicalKey], missingMedia: []});
  expect(() => arcadeParentOptions({...input, files: [zip, differential]})).toThrow("RUNTIME_ARCADE_DISK_PARENT_REQUIRED");
});
