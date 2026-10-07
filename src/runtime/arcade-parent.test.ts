import {expect, it} from "vitest";
import {arcadeParentOptions} from "./arcade-parent.js";

const file = (name: string) => ({logicalKey: name, name, sha256: "a".repeat(64), sizeBytes: 1});
const rom = {name: "base.bin", size: "3", crc: "11223344"};
const request = {
  directory: {platformId: "arcade", defaultCoreId: "fbneo", allowedCoreIds: ["fbneo", "fbalpha2012_cps1"]},
  config: {content: {kind: "ARCADE", entryFile: "clone.zip"},
    cores: {fbneo: {options: {region: "japan"}}, fbalpha2012_cps1: {parentFiles: ["base.zip"]}}},
  files: [file("clone.zip")], archives: {"clone.zip": []},
  arcadeCatalog: {clone: {parent: "base", bios: false, roms: [{...rom, merge: "base.bin"}]},
    base: {parent: null, bios: false, roms: [rom]}},
};
it("projects the actual missing parent archive without preparing a launch or requiring fingerprints", () => {
  expect(arcadeParentOptions(request)).toMatchObject({coreId: "fbneo", parentFiles: [], missingParents: ["base.zip"]});
  expect(arcadeParentOptions({...request, archives: {"clone.zip": [{name: "base.bin", sizeBytes: 3, crc32: rom.crc}]}}))
    .toMatchObject({parentFiles: [], missingParents: []});
});
it("attaches a verified ancestor while preserving every other core and option", () => {
  const result = arcadeParentOptions({...request, attachFile: "base.zip", files: [...request.files, file("base.zip")],
    archives: {...request.archives, "base.zip": [{name: "base.bin", sizeBytes: 3, crc32: rom.crc}]}});
  expect(result).toMatchObject({coreId: "fbneo", parentFiles: ["base.zip"], missingParents: []});
  expect(result.config).toEqual({...request.config, cores: {...request.config.cores,
    fbneo: {...request.config.cores.fbneo, parentFiles: ["base.zip"]}}});
});
it("rebinds the selected core to the uploaded parent rather than a previous alias", () => {
  const input = {...request,
    config: {...request.config, cores: {fbneo: {...request.config.cores.fbneo, parentFiles: ["old/base.zip"]},
      fbalpha2012_cps1: {parentFiles: ["old/base.zip"]}}},
    files: [...request.files, file("old/base.zip"), file("base.zip")], attachFile: "base.zip",
    archives: {...request.archives, "old/base.zip": [], "base.zip": [{name: "base.bin", sizeBytes: 3, crc32: rom.crc}]}};
  const result = arcadeParentOptions(input);
  expect(result).toMatchObject({parentFiles: ["base.zip"], missingParents: [], config: {cores: {
    fbneo: {parentFiles: ["base.zip"], options: request.config.cores.fbneo.options},
    fbalpha2012_cps1: {parentFiles: ["old/base.zip"]},
  }}});
});
it("stores an incomplete parent reference without turning member readiness into a replacement gate", () => {
  expect(arcadeParentOptions({...request, attachFile: "base.zip", files: [...request.files, file("base.zip")],
    archives: {...request.archives, "base.zip": []}})).toMatchObject({missingParents: ["base.zip"],
    config: {cores: {fbneo: {parentFiles: ["base.zip"]}}}});
});
it("rejects unrelated parent references and forbids replacing the entry archive", () => {
  for (const name of ["other.zip", "clone.zip"]) {
    expect(() => arcadeParentOptions({...request, attachFile: name,
      files: name === "clone.zip" ? request.files : [...request.files, file(name)],
      archives: {...request.archives, [name]: []}})).toThrow("RUNTIME_PARENT_INVALID");
  }
});
