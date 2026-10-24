// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {createHash} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {discoverContentDependencies, prepareHostInput} from "../scripts/runtime-host-input.mjs";
import type {RuntimeContentFile} from "../src/runtime/types.js";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
const disc = {platformId: "psx", defaultCoreId: "pcsx_rearmed", allowedCoreIds: ["pcsx_rearmed"]};
async function tree(content: Record<string, Uint8Array>) {
  const root = await mkdtemp(join(tmpdir(), "runtime-cue-")); roots.push(root);
  const files: RuntimeContentFile[] = [], locators: Record<string, {path: string; offset: number; sizeBytes: number}> = {};
  for (const [name, bytes] of Object.entries(content)) {
    const path = join(root, String(files.length)); await writeFile(path, bytes);
    files.push({logicalKey: name, name, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
    locators[name] = {path, offset: 0, sizeBytes: bytes.length};
  }
  return {files, locators};
}

it("keeps incidental disc sheets opaque when the selected project core does not accept CUE entries", async () => {
  const input = await tree({"data.xp3": Uint8Array.of(1), "bonus/disc.cue": Uint8Array.of(0xff)});
  // No locator: unrelated content must not even be opened as a dependency sheet.
  delete input.locators["bonus/disc.cue"];
  await expect(discoverContentDependencies({...input,
    directory: {platformId: "kirikiri", defaultCoreId: "kirikiri2", allowedCoreIds: ["kirikiri2"]}})).resolves.toEqual({files: []});
});

it("uses the same CP932 track names during discovery and actual disc preparation", async () => {
  const cue = Buffer.concat([Buffer.from('FILE "'), Buffer.from("836783898362834e", "hex"), Buffer.from('.wav" WAVE\n TRACK 01 AUDIO\n')]);
  const input = await tree({"disc/disc.cue": cue, "disc/トラック.wav": Uint8Array.of(1)});
  expect((await discoverContentDependencies({...input, directory: disc})).files).toEqual([
    {logicalKey: "disc/トラック.wav", relativeTo: "disc/disc.cue", relativePath: "トラック.wav"},
  ]);
  const prepared = await prepareHostInput({...input, directory: disc, fingerprints: {},
    config: {content: {kind: "SINGLE_FILE", entryFile: "disc/disc.cue"}}});
  expect(prepared.cueFiles).toEqual(["disc/トラック.wav"]);
});

it("discovers ASCII track references despite legacy comments before the tracks are copied", async () => {
  const cue = Buffer.concat([Buffer.from("REM "), Buffer.from([0x82, 0xa0]), Buffer.from('\nFILE "track.bin" BINARY\n')]);
  const input = await tree({"disc.cue": cue});
  expect((await discoverContentDependencies({...input, directory: disc})).files).toEqual([
    {logicalKey: "track.bin", relativeTo: "disc.cue", relativePath: "track.bin"},
  ]);
});

it("requires an encoding decision when legacy candidates name different uncopied tracks", async () => {
  const cue = Buffer.concat([Buffer.from('FILE "'), Buffer.from("836783898362834e", "hex"), Buffer.from('.bin" BINARY\n')]);
  const input = await tree({"disc.cue": cue});
  await expect(discoverContentDependencies({...input, directory: disc})).rejects.toThrow("RUNTIME_CUE_ENCODING_REQUIRED");
});
