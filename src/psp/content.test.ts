import {describe, expect, it} from "vitest";
import {configureRuntime} from "../runtime/configure.js";
import {prepareRuntime} from "../runtime/prepare.js";
const file = (name: string) => ({name, logicalKey: name, sizeBytes: 128, sha256: "a".repeat(64)});
const directory = {platformId: "psp", defaultCoreId: "ppsspp", allowedCoreIds: ["ppsspp"]};
const prepare = (names: string[]) => {
  const files = names.map(file), config = configureRuntime({platformId: "psp", coreIds: ["ppsspp"], files});
  return prepareRuntime({directory, config, files, fingerprints: {"retrom-runtime/ppsspp": "b".repeat(64)}});
};
describe("PSP content layouts", () => {
  it("delivers a PBP and every sibling resource in a seekable STORE package", () => {
    const result = prepare(["project/launch.pbp", "project/script.bin", "project/music/theme.ogg"]);
    expect(result.resources[0]).toMatchObject({kind: "SEEKABLE_BLOB", encoding: "ZIP", entryFile: "launch.pbp",
      files: ["project/launch.pbp", "project/script.bin", "project/music/theme.ogg"],
      paths: {"project/launch.pbp": "launch.pbp", "project/script.bin": "script.bin", "project/music/theme.ogg": "music/theme.ogg"}});
    expect(result.targetOptions).toEqual({projectEntryPath: "launch.pbp"});
  });
  it("keeps ordinary disc reads bounded without assembling another disc", () => {
    const result = prepare(["disc.iso"]);
    expect(result.resources[0]).toMatchObject({kind: "SEEKABLE_BLOB", files: ["disc.iso"]});
    expect(result.resources[0]).not.toHaveProperty("encoding");
    expect(result.targetOptions).toEqual({projectEntryPath: null});
  });
});
