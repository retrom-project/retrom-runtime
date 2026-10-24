// @vitest-environment node
import {afterEach, expect, it} from "vitest";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, writeFile, rm, access} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {unzipSync, zipSync} from "fflate";
import {assembleResource, prepareHostInput, configureHostInput, discoverContentDependencies, identifyHostBIOS, flycastTable, contentHostBIOSRequirements, hostDOSEntryCandidates} from "../scripts/runtime-host-input.mjs";
import {gbkProgramName, legacyZip} from "./zip-encoding-fixture.js";
import type {RuntimeContentFile} from "../src/runtime/types.js";
const roots: string[] = [];
const discDirectory = {platformId: "psx", defaultCoreId: "pcsx_rearmed", allowedCoreIds: ["pcsx_rearmed"]};
afterEach(async () => {await Promise.all(roots.splice(0).map(path => rm(path, {recursive: true, force: true})));});
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function tree(content: Record<string, Uint8Array>) {
  const root = await mkdtemp(join(tmpdir(), "retrom-resource-test-")); roots.push(root);
  const files: RuntimeContentFile[] = [], locators: Record<string, {path: string; offset: number; sizeBytes: number}> = {};
  for (const [name, bytes] of Object.entries(content)) {
    const path = join(root, `${files.length}.bin`); await writeFile(path, bytes);
    locators[name] = {path, offset: 0, sizeBytes: bytes.length}; files.push({logicalKey: name, name, sha256: sha(bytes), sizeBytes: bytes.length});
  }
  return {root, files, locators};
}

it("uses logical package intervals for evidence, nested native archives and ZIP assembly", async () => {
  const ini = Buffer.from("[Game]\nLibrary=RGSS104E.dll\nTitle=Package\n");
  const archive = Buffer.from(zipSync({"PLAY.EXE": Uint8Array.of(1, 2, 3)}));
  const input = await tree({"Game.ini": ini, "game.zip": archive});
  const physical = join(input.root, "physical-package");
  await writeFile(physical, Buffer.concat([Buffer.from("BEFORE"), ini, Buffer.from("BETWEEN"), archive, Buffer.from("AFTER")]));
  input.locators["Game.ini"] = {path: physical, offset: 6, sizeBytes: ini.length};
  input.locators["game.zip"] = {path: physical, offset: 6 + ini.length + 7, sizeBytes: archive.length};
  const configured = await configureHostInput({...input, platformId: "rpgmaker", coreIds: ["rpgmaker"]});
  expect(configured.evidence?.["Game.ini"]).toEqual({text: ini.toString()});
  expect(await hostDOSEntryCandidates({...input, config: {content: {kind: "DOS_BUNDLE", entryFile: "game.zip"}}}))
    .toEqual({entries: ["PLAY.EXE"]});
  const output = await assembleResource({...input, outputPath: join(input.root, "assembled.zip")});
  const members = unzipSync(await readFile(output.path));
  expect(Buffer.from(members["Game.ini"])).toEqual(ini);
  expect(Buffer.from(members["game.zip"])).toEqual(archive);
});
it("streams a deterministic ordinary ZIP with virtual project paths and exact source identities", async () => {
  const input = await tree({"project/Game.ini": Buffer.from("[Game]"), "project/Data/Map.rxdata": Uint8Array.of(1, 2, 3)});
  const paths = {"project/Game.ini": "Game.ini", "project/Data/Map.rxdata": "Data/Map.rxdata"};
  const a = await assembleResource({...input, paths, outputPath: join(input.root, "one.zip")});
  const b = await assembleResource({...input, files: [...input.files].reverse(), paths, outputPath: join(input.root, "two.zip")});
  expect(a.sha256).toBe(b.sha256);
  expect(unzipSync(await readFile(a.path))).toEqual({"Data/Map.rxdata": Uint8Array.of(1, 2, 3), "Game.ini": new TextEncoder().encode("[Game]")});
  const failed = join(input.root, "failed.zip"); input.files[0].sha256 = "0".repeat(64);
  await expect(assembleResource({...input, paths, outputPath: failed})).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
  await expect(access(failed)).rejects.toThrow();
});
it("keeps a single CUE disc's actual tracks and rejects a missing referenced track", async () => {
  const input = await tree({"game/disc.cue": Buffer.from('FILE "track.bin" BINARY\n TRACK 01 MODE1/2352\n'), "game/track.bin": Uint8Array.of(3)});
  const request = {...input, directory: {platformId: "psx", defaultCoreId: "pcsx_rearmed", allowedCoreIds: ["pcsx_rearmed"]},
    fingerprints: {}, config: {content: {kind: "SINGLE_FILE", entryFile: "game/disc.cue"}}};
  expect((await prepareHostInput(request)).cueFiles).toEqual(["game/track.bin"]);
  await expect(prepareHostInput({...request, files: [input.files[0]]})).rejects.toThrow("RUNTIME_CUE_TRACK_MISSING");
});
it("discovers the actual safe CUE references before tracks have been copied, retaining existing references", async () => {
  const input = await tree({"disc/main.cue": Buffer.from('FILE "track 1.iso" BINARY\nFILE "audio.wav" WAVE\nFILE "audio.wav" WAVE\n')});
  expect(await discoverContentDependencies({...input, directory: discDirectory})).toEqual({files: [
    {logicalKey: "disc/track 1.iso", relativeTo: "disc/main.cue", relativePath: "track 1.iso"},
    {logicalKey: "disc/audio.wav", relativeTo: "disc/main.cue", relativePath: "audio.wav"},
  ]});
  const tracks = await tree({"disc/audio.wav": Uint8Array.of(2)});
  expect((await discoverContentDependencies({...input, directory: discDirectory, files: [...input.files, ...tracks.files]})).files).toHaveLength(2);
});
it.each(["../track.bin", "/track.bin", "track\\file.bin", "./track.bin"])("rejects unsafe CUE dependency %s", async path => {
  const input = await tree({"disc.cue": Buffer.from(`FILE "${path}" BINARY\n`)});
  await expect(discoverContentDependencies({...input, directory: discDirectory})).rejects.toThrow("RUNTIME_CUE_INVALID");
});
it("requires immutable bounded CUE text and does not inspect ordinary ROM bytes", async () => {
  const input = await tree({"disc.cue": Buffer.from('FILE "track.bin" BINARY\n'), "game.nes": Uint8Array.of(1)});
  input.files[0].sha256 = "0".repeat(64);
  await expect(discoverContentDependencies({...input, directory: discDirectory})).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
  const invalid = await tree({"disc.cue": Uint8Array.of(255)});
  await expect(discoverContentDependencies({...invalid, directory: discDirectory})).rejects.toThrow("RUNTIME_CUE_INVALID");
  const tooLarge = await tree({"disc.cue": new Uint8Array(1024 * 1024 + 1)});
  await expect(discoverContentDependencies({...tooLarge, directory: discDirectory})).rejects.toThrow("RUNTIME_CUE_INVALID");
  expect(await discoverContentDependencies({files: [input.files[1]], locators: {}})).toEqual({files: []});
});
it("reads bounded immutable configuration evidence and real DOS executable members in the runtime", async () => {
  const ini = await tree({"project/Game.ini": Buffer.from("[Game]\nScripts=Data/Scripts.rxdata\n")});
  const request = {...ini, platformId: "rpgmaker", coreIds: ["rpgmaker"]};
  expect((await configureHostInput(request)).evidence?.["project/Game.ini"]?.text).toContain("Scripts.rxdata");
  ini.files[0].sha256 = "0".repeat(64);
  await expect(configureHostInput(request)).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
  const dos = await tree({"game.zip": zipSync({"folder/game.exe": Uint8Array.of(1), "readme.txt": Uint8Array.of(2)})});
  expect((await configureHostInput({...dos, platformId: "dos", coreIds: ["dosbox_pure"]})).archiveMembers?.["game.zip"])
    .toEqual(["folder/game.exe", "readme.txt"]);
});
it("samples ONS scripts from their package interval so configure detects the real encoding", async () => {
  // GBK text, XOR 0x84 as stored in nscript.dat, longer than the 1 MiB sample.
  const line = Buffer.from("3bcbaec9abbababbafd7e90a", "hex"), lines = Buffer.alloc(1024 * 1024 + 7);
  for (let offset = 0; offset < lines.length; offset += line.length) {line.copy(lines, offset);}
  const script = lines.map(byte => byte ^ 0x84), font = Buffer.from("font");
  const input = await tree({"水色/nscript.dat": script, "水色/default.ttf": font, "水色/readme.txt": Buffer.from("not a script")});
  const physical = join(input.root, "physical-package");
  await writeFile(physical, Buffer.concat([Buffer.from("PK-HEADER"), script, font]));
  input.locators["水色/nscript.dat"] = {path: physical, offset: 9, sizeBytes: script.length};
  const configured = await configureHostInput({...input, platformId: "ons", coreIds: ["onscripter_yuri"]});
  const sample = Buffer.from(configured.evidence?.["水色/nscript.dat"]?.prefixBase64 ?? "", "base64");
  expect(sample.equals(script.subarray(0, 1024 * 1024))).toBe(true);
  expect(Object.keys(configured.evidence ?? {})).toEqual(["水色/nscript.dat"]);
});
it("requires the selected verified provider for native detection and verifies staged game bytes first", async () => {
  const input = await tree({"game/sky.dnr": Uint8Array.of(1, 2, 3)});
  const request = {...input, platformId: "scummvm", coreIds: ["scummvm"]};
  await expect(configureHostInput(request)).rejects.toThrow("RUNTIME_DETECTOR_UNAVAILABLE");
  input.files[0].sha256 = "0".repeat(64);
  await expect(configureHostInput({...request, providerRoots: {"retrom-runtime": "/verified-provider"}}))
    .rejects.toThrow("RUNTIME_CONTENT_CHANGED");
});

it("identifies PSX regional firmware from bounded disc evidence, including a CUE track", async () => {
  const bytes = Buffer.alloc(64 * 1024);
  bytes.write("Licensed by Sony Computer Entertainment Amer  ica", 4 * 2352 + 32);
  const input = await tree({"disc.cue": Buffer.from('FILE "disc.bin" BINARY\n TRACK 01 MODE2/2352\n'), "disc.bin": bytes});
  const request = {...input, directory: {platformId: "psx", defaultCoreId: "mednafen_psx_hw", allowedCoreIds: ["mednafen_psx_hw"]},
    fingerprints: {}, config: {content: {kind: "SINGLE_FILE", entryFile: "disc.cue"}}};
  expect((await prepareHostInput(request)).firmwareEvidence).toEqual({psxRegion: "US"});
  input.files[1].sizeBytes++;
  await expect(prepareHostInput(request)).rejects.toThrow("RUNTIME_CONTENT_CHANGED");
});
it("checks an explicit DOS executable against actual archive members but leaves the menu unopened", async () => {
  const input = await tree({"game.zip": zipSync({"START.BAT": Uint8Array.of(1), "GAME.EXE": Uint8Array.of(2)})});
  const request = {...input, directory: {platformId: "dos", defaultCoreId: "dosbox_pure", allowedCoreIds: ["dosbox_pure"]},
    fingerprints: {}, config: {content: {kind: "DOS_BUNDLE", entryFile: "game.zip", entryPath: "START.BAT"}}};
  expect((await prepareHostInput(request)).dosEntries).toEqual(["START.BAT", "GAME.EXE"]);
  expect((await prepareHostInput({...request, config: {content: {kind: "DOS_BUNDLE", entryFile: "game.zip"}}})).dosEntries).toBeUndefined();
});

it("uses the same lossless GBK DOS name for import evidence, candidates and saved program validation", async () => {
  const input = await tree({"game.zip": legacyZip([{name: gbkProgramName, data: Uint8Array.of(1)}])});
  const config = {content: {kind: "DOS_BUNDLE", entryFile: "game.zip", entryPath: "金庸群侠传/PLAY.BAT"}};
  expect((await configureHostInput({...input, platformId: "dos", coreIds: ["dosbox_pure"]})).archiveMembers?.["game.zip"])
    .toEqual([config.content.entryPath]);
  expect(await hostDOSEntryCandidates({...input, config})).toEqual({entries: [config.content.entryPath]});
  const request = {...input, directory: {platformId: "dos", defaultCoreId: "dosbox_pure", allowedCoreIds: ["dosbox_pure"]},
    fingerprints: {}, config};
  expect((await prepareHostInput(request)).dosEntries).toEqual([config.content.entryPath]);
});

it("retains named firmware ZIP candidates while scoring incorrect or missing members as unmatched", async () => {
  const input = await tree({"bios.zip": zipSync({"bios.bin": Uint8Array.of(1, 2)})});
  const requirement = {requirementKey: "emulatorjs/fbneo/bios.zip", coreId: "fbneo", providerId: "emulatorjs", targetId: "fbneo",
    logicalName: "bios.zip", required: true, condition: "ARCADE_BIOS", sizeBytes: null, md5: null, sha256: null,
    delivery: "EXTERNAL_FILE" as const, virtualPath: "bios.zip", activationOptions: {},
    members: [{name: "bios.bin", sizeBytes: 2, crc32: "ffffffff", sha1: "", required: true}]};
  const file = {...input.files[0], md5: "a".repeat(32)};
  expect(await identifyHostBIOS({file, path: input.locators[file.name].path, requirements: [requirement]}))
    .toMatchObject([{...requirement, candidate: {matchedMembers: 0, totalMembers: 1}}]);
  expect(await identifyHostBIOS({file: {...file, name: "random.zip"}, path: input.locators[file.name].path, requirements: [requirement]})).toEqual([]);
  expect(await identifyHostBIOS({file, path: input.locators[file.name].path, requirements: [{...requirement,
    members: [{...requirement.members[0], sizeBytes: 3}]}]})).toMatchObject([{candidate: {matchedMembers: 0}}]);
});

it("reads the compiled Flycast catalog envelope and binds its declared core SHA to the selected Provider", async () => {
  const bytes = Uint8Array.of(1, 2, 3), machine = {name: "game", parent: null, platform: "naomi2", mediaType: "CARTRIDGE",
    disc: null, files: [{name: "game.ic1", sizeBytes: 4, crc32: "12345678", optional: false}]};
  const envelope = {schemaVersion: 1, kind: "FLYCAST_ROM_REQUIREMENTS", core: {filename: "0.bin", sha256: sha(bytes)}, machines: [machine]};
  const catalog = Buffer.from(JSON.stringify(envelope));
  const input = await tree({"core": bytes, "catalog": catalog});
  const requirement = {core: {path: "0.bin", sha256: sha(bytes)}, catalog: {path: "1.bin", sha256: sha(catalog)}};
  const tables = await Promise.all(Array.from({length: 8}, () => flycastTable(input.root, requirement)));
  expect(tables[0]).toEqual([machine]);
  for (const table of tables) {expect(table).toBe(tables[0]);}
  const wrongCore = Buffer.from(JSON.stringify({...envelope, core: {...envelope.core, sha256: "f".repeat(64)}}));
  await writeFile(join(input.root, "1.bin"), wrongCore);
  await expect(flycastTable(input.root, {...requirement, catalog: {...requirement.catalog, sha256: sha(wrongCore)}}))
    .rejects.toThrow("RUNTIME_FLYCAST_CATALOG_INVALID");
});

it("reports modified installed BIOS members as missing usable firmware as well as CRC warnings", async () => {
  const input = await tree({"mslug3h.zip": zipSync({})});
  const request = {...input,
    directory: {platformId: "arcade", defaultCoreId: "fbneo", allowedCoreIds: ["fbneo"]},
    config: {content: {kind: "ARCADE" as const, entryFile: "mslug3h.zip"}}};
  const projected = await contentHostBIOSRequirements(request);
  const bios = projected.biosRequirements.find(requirement => requirement.logicalName === "neogeo.zip")!;
  expect(bios.members?.length).toBeGreaterThan(0);
  const bytes = zipSync(Object.fromEntries(bios.members!.map(member => [member.name, new Uint8Array(member.sizeBytes)])));
  const path = join(input.root, "installed-bios.zip"); await writeFile(path, bytes);
  const withBIOS = await contentHostBIOSRequirements({...request, biosFiles: [{filename: "neogeo.zip", path,
    requirementKey: bios.requirementKey}]});
  expect(withBIOS.biosRequirements).toEqual(projected.biosRequirements);
  expect(withBIOS.crcWarnings).toEqual(expect.arrayContaining([expect.objectContaining({role: "BIOS", file: "neogeo.zip"})]));
  expect(withBIOS.missingRomMembers.filter(item => item.role === "BIOS")).toHaveLength(bios.members!.filter(member => member.required).length);
  const required = bios.members!.find(member => member.required)!;
  const incomplete = zipSync(Object.fromEntries(bios.members!.filter(member => member.name !== required.name)
    .map(member => [member.name, new Uint8Array(member.sizeBytes)])));
  await writeFile(path, incomplete);
  const missing = await contentHostBIOSRequirements({...request, biosFiles: [{filename: "neogeo.zip", path, requirementKey: bios.requirementKey}]});
  expect(missing.missingRomMembers).toContainEqual(expect.objectContaining({role: "BIOS", coreId: "fbneo", member: required.name, reason: "MISSING"}));
});
