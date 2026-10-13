import {expect, it} from "vitest";
import {prepareRuntime} from "./prepare.js";

const rom = (name: string) => ({name, size: "3", crc: "11223344"});
const file = (name: string) => ({logicalKey: `stored/${name}`, name, sizeBytes: 100, sha256: "a".repeat(64)});
const catalog = {
  clone: {parent: "base", bios: false, roms: [{...rom("base.bin"), merge: "base.bin"}]},
  base: {parent: "grand", bios: false, roms: [rom("base.bin"), {...rom("grand.bin"), crc: "87654321", merge: "grand.bin"}]},
  grand: {parent: null, bios: false, roms: [{...rom("grand.bin"), crc: "87654321"}]},
};
it.each(["fbneo", "mame2003", "mame2003_plus", "fbalpha2012_cps1", "fbalpha2012_cps2", "mame_arcade"])(
  "%s delivers each selected parent as an original named file", coreId => {
    const provider = coreId === "mame_arcade" ? "retrom-runtime/mame-arcade" : `emulatorjs/${coreId.replaceAll("_", "-")}`;
    const request = {directory: {platformId: "arcade", defaultCoreId: coreId, allowedCoreIds: [coreId]},
      fingerprints: {[provider]: "b".repeat(64)},
      config: {content: {kind: "ARCADE", entryFile: "stored/alias.zip"}, cores: {[coreId]: {
        romSet: "clone", parentFiles: ["stored/BASE.ZIP", "stored/grand.zip"]}}},
      files: [file("alias.zip"), file("BASE.ZIP"), file("grand.zip")], arcadeCatalog: catalog,
      archives: {"stored/alias.zip": [], "stored/BASE.ZIP": [{name: "base.bin", sizeBytes: 3, crc32: "11223344"}],
        "stored/grand.zip": [{name: "grand.bin", sizeBytes: 3, crc32: "87654321"}]}};
    const result = prepareRuntime(request);
    expect(result.resources.find(resource => resource.role === "parent")).toEqual({
      kind: "EXTERNAL_FILE_SET", role: "parent", ordinal: 0, files: ["stored/BASE.ZIP", "stored/grand.zip"],
      paths: {"stored/BASE.ZIP": "base.zip", "stored/grand.zip": "grand.zip"},
    });
    const single = prepareRuntime({...request, arcadeCatalog: {...catalog, base: {...catalog.base, parent: null}}});
    expect(single.resources.find(resource => resource.role === "parent")).toMatchObject({kind: "EXTERNAL_FILE_SET",
      files: ["stored/BASE.ZIP"], paths: {"stored/BASE.ZIP": "base.zip"}});
    expect(result.romHash).toBe(single.romHash);
  });
it("preserves explicit per-core Parents for targets without a DAT selection capability", () => {
  const files = [file("game.zip"), file("base.zip"), file("unused.zip")];
  const result = prepareRuntime({directory: {platformId: "model3", defaultCoreId: "supermodel", allowedCoreIds: ["supermodel"]},
    fingerprints: {"emulatorjs/supermodel": "b".repeat(64)}, files,
    config: {content: {kind: "SINGLE_FILE", entryFile: files[0].logicalKey}, cores: {
      supermodel: {parentFiles: [files[1].logicalKey]},
    }}});
  expect(result.resources.find(resource => resource.role === "parent")).toMatchObject({kind: "EXTERNAL_FILE_SET", files: [files[1].logicalKey]});
});
