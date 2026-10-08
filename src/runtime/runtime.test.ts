import {describe, expect, it} from "vitest";
import {arcadeDependencies} from "./arcade.js";
import {configureRuntime, dosEntryCandidates} from "./configure.js";
import {contentHash, restorability} from "./identity.js";
import {parseRuntimeConfiguration} from "./configuration.js";
import {inspectRuntimeIdentity, prepareRuntime} from "./prepare.js";
import {runtimeCatalog, runtimeBindings} from "./catalog.js";
import {biosCatalog, identifyBIOSFile, resolveBIOSRequirements} from "./bios.js";
import type {RuntimeContentFile} from "./types.js";
const sha = "a".repeat(64), fingerprint = "b".repeat(64);
const file = (logicalKey: string, digest = sha): RuntimeContentFile => ({logicalKey, name: logicalKey, sizeBytes: 128, sha256: digest});
const directory = {platformId: "nes", defaultCoreId: "fceumm", allowedCoreIds: ["fceumm", "nestopia"]};
const fingerprints = {"emulatorjs/fceumm": fingerprint, "emulatorjs/nestopia": fingerprint};
describe("unified runtime facts", () => {
  it("retains 110 declared Targets and the 109 previously connected product bindings", () => {
    expect(runtimeCatalog().providers.map(provider => provider.targets.length)).toEqual([75, 35]);
    expect(runtimeBindings).toHaveLength(109);
    expect(runtimeBindings.some(binding => binding.providerId === "emulatorjs" && binding.targetId === "ppsspp")).toBe(false);
  });
  it("prepares restored Thomson options from frozen context and remaps a renamed single ROM", () => {
    const request = {directory: {platformId: "thomson", defaultCoreId: "theodore", allowedCoreIds: ["theodore"]},
      files: [file("renamed.sap")], fingerprints: {"emulatorjs/theodore": fingerprint},
      config: {content: {kind: "SINGLE_FILE", entryFile: "renamed.sap"}, cores: {theodore: {options: {thomsonModel: "TO8"}}}},
      savedContext: {coreId: "theodore", providerId: "emulatorjs", targetId: "theodore", coreFingerprint: fingerprint,
        romHash: sha, checkpointFormat: "emulatorjs-state-v1-storage-v1",
        content: {kind: "SINGLE_FILE", entryFile: "original.sap"}, runtimeOptions: {dosEntryPath: null, thomsonModel: "TO7"}}};
    const restored = prepareRuntime(request);
    expect(restored.targetOptions).toEqual({dosEntryPath: null, thomsonModel: "TO7"});
    expect(restored.config.content).toEqual({kind: "SINGLE_FILE", entryFile: "renamed.sap"});
    expect(restored.romHash).toBe(sha);
    expect(() => prepareRuntime({...request, files: [file("renamed.sap", "c".repeat(64))]})).toThrow("CONTENT_CHANGED");
    expect(() => prepareRuntime({...request, fingerprints: {"emulatorjs/theodore": "c".repeat(64)}})).toThrow("CORE_CHANGED");
    expect(() => prepareRuntime({...request, savedContext: {...request.savedContext,
      runtimeOptions: {dosEntryPath: null, thomsonModel: "BOGUS"}}})).toThrow("RUNTIME_SAVED_CONTEXT_INVALID");
    expect(prepareRuntime({...request, savedContext: undefined}).targetOptions.thomsonModel).toBe("TO8");
  });

  it.each([
    ["game_to8d.sap", "TO8D"], ["game_TO8.sap", "TO8"], ["TO9P.sap", "TO9+"], ["to9.sap", "TO9"],
    ["to770.sap", "TO7/70"], ["to7.sap", "TO7"], ["mo6.sap", "MO6"], ["pc128.sap", "PC128"],
    ["mo5.sap", "MO5"], ["memo5.sap", "MO5"], ["game.M5", "MO5"], ["memo7.sap", "TO8"],
    ["game.m7", "TO8"], ["unknown.sap", "TO8"], ["To7.sap", "TO8"], ["TO8D_TO7.sap", "TO8D"],
  ])("freezes native Auto for %s as %s without persisting an inferred Game rule", (entryFile, model) => {
    const config = {content: {kind: "SINGLE_FILE", entryFile}};
    const request = {directory: {platformId: "thomson", defaultCoreId: "theodore", allowedCoreIds: ["theodore"]},
      files: [file(entryFile)], fingerprints: {"emulatorjs/theodore": fingerprint}, config};
    const prepared = prepareRuntime(request);
    expect(prepared.targetOptions.thomsonModel).toBe(model);
    expect(prepared.config).toEqual(config);
    expect(prepareRuntime({...request, config: {...config, cores: {theodore: {options: {thomsonModel: "Auto"}}}}})
      .targetOptions.thomsonModel).toBe(model);
    const savedContext = {...prepared, checkpointFormat: prepared.checkpoint!.writeFormat,
      content: config.content, runtimeOptions: prepared.targetOptions};
    const {coreId, providerId, targetId, coreFingerprint, romHash, checkpointFormat, content, runtimeOptions} = savedContext;
    const restored = prepareRuntime({...request, files: [file("renamed_TO8.sap")],
      config: {content: {kind: "SINGLE_FILE", entryFile: "renamed_TO8.sap"}},
      savedContext: {coreId, providerId, targetId, coreFingerprint, romHash, checkpointFormat, content, runtimeOptions}});
    expect(restored.targetOptions.thomsonModel).toBe(model);
  });

  it("restores frozen DOS entry and ScummVM detection options through the same context boundary", () => {
    const dosDirectory = {platformId: "dos", defaultCoreId: "dosbox_pure", allowedCoreIds: ["dosbox_pure"]};
    const dos = prepareRuntime({directory: dosDirectory, files: [file("renamed.zip")],
      fingerprints: {"emulatorjs/dosbox-pure": fingerprint}, dosEntries: ["A.EXE", "B.EXE"],
      config: {content: {kind: "DOS_BUNDLE", entryFile: "renamed.zip", entryPath: "B.EXE"}},
      savedContext: {coreId: "dosbox_pure", providerId: "emulatorjs", targetId: "dosbox-pure", coreFingerprint: fingerprint,
        romHash: sha, checkpointFormat: "emulatorjs-state-v1-storage-v1",
        content: {kind: "DOS_BUNDLE", entryFile: "original.zip", entryPath: "A.EXE"}, runtimeOptions: {dosEntryPath: "A.EXE"}}});
    expect(dos.targetOptions.dosEntryPath).toBe("A.EXE");
    expect(dos.config.content).toMatchObject({entryFile: "renamed.zip", entryPath: "A.EXE"});
    const projectFiles = [file("sky.dsk")];
    const request = {directory: {platformId: "scummvm", defaultCoreId: "scummvm", allowedCoreIds: ["scummvm"]},
      files: projectFiles, fingerprints: {"retrom-runtime/scummvm": fingerprint},
      config: {content: {kind: "SCUMMVM_PROJECT"}, cores: {scummvm: {options: {engineId: "sky", gameId: "wrong", root: "", language: "en", platform: "pc", extra: "", guiOptions: "", filename: null}}}},
      savedContext: {coreId: "scummvm", providerId: "retrom-runtime", targetId: "scummvm", coreFingerprint: fingerprint,
        romHash: contentHash(projectFiles, "TREE"), checkpointFormat: "scummvm-save-bundle-v1-storage-v1",
        content: {kind: "SCUMMVM_PROJECT"}, runtimeOptions: {engineId: "sky", gameId: "sky", root: "", language: "en", platform: "pc", extra: "", guiOptions: "", filename: null}}};
    expect(prepareRuntime(request).targetOptions).toEqual(request.savedContext.runtimeOptions);
    expect(() => prepareRuntime({...request, files: [file("renamed/sky.dsk")]})).toThrow("CONTENT_CHANGED");
  });

  it("keeps an explicit MAME machine when the single archive is renamed", () => {
    const request = {directory: {platformId: "arcade", defaultCoreId: "mame_arcade", allowedCoreIds: ["mame_arcade"]},
      files: [file("pacman.zip")], fingerprints: {"retrom-runtime/mame-arcade": fingerprint},
      config: {content: {kind: "ARCADE", entryFile: "pacman.zip"}}, archives: {"pacman.zip": []},
      arcadeCatalog: {pacman: {parent: null, bios: false, roms: []}}};
    const original = prepareRuntime(request);
    expect(original.targetOptions.machine).toBe("pacman");
    const renamed = {...request, files: [file("renamed.zip")], archives: {"renamed.zip": []},
      config: {content: {kind: "ARCADE", entryFile: "renamed.zip"}, cores: {mame_arcade: {options: {machine: "pacman"}}}}};
    expect(prepareRuntime(renamed).targetOptions.machine).toBe("pacman");
    const savedContext = {coreId: original.coreId, providerId: original.providerId, targetId: original.targetId,
      coreFingerprint: original.coreFingerprint, romHash: original.romHash, checkpointFormat: original.checkpoint!.writeFormat,
      content: original.config.content, runtimeOptions: original.targetOptions};
    const restored = prepareRuntime({...renamed, config: {...renamed.config, cores: {mame_arcade: {options: {machine: "other"}}}},
      savedContext});
    expect(restored.targetOptions.machine).toBe("pacman");
    expect(restored.config.content).toEqual({kind: "ARCADE", entryFile: "renamed.zip"});
    expect(restored.resources[0].files).toEqual(["renamed.zip"]);
    expect(restored.romHash).toBe(sha);
  });

  it("hashes a single ROM by bytes and a project tree by logical path even with one file", () => {
    const files = [file("Game.ini")];
    expect(contentHash(files, "FILE")).toBe(sha);
    expect(contentHash(files, "TREE")).not.toBe(sha);
    expect(contentHash(files, "TREE")).not.toBe(contentHash([file("nested/Game.ini")], "TREE"));
    expect(contentHash([file("b"), file("a")], "TREE")).toBe(contentHash([file("a"), file("b")], "TREE"));
    expect(() => contentHash([file("CharSet/#1.png"), file("画像/絵.png")], "TREE")).not.toThrow();
  });
  it("uses the whole Game active tree for every core and for list identity checks", () => {
    const request = {directory, fingerprints, files: [file("game.nes"), file("parent.zip")],
      config: {content: {kind: "SINGLE_FILE", entryFile: "game.nes"}}};
    const first = prepareRuntime(request), second = prepareRuntime({...request, coreId: "nestopia"});
    expect(first.romHash).toBe(second.romHash);
    expect(inspectRuntimeIdentity(request).romHash).toBe(first.romHash);
    expect(first.romHash).not.toBe(sha);
  });
  it("checks every configured core option rather than deferring hidden malformed fields until switching", () => {
    expect(() => prepareRuntime({directory, fingerprints, files: [file("game.nes")], config: {
      content: {kind: "SINGLE_FILE", entryFile: "game.nes"}, cores: {nestopia: {options: {arbitrary: {unsafe: true}}}},
    }})).toThrow("RUNTIME_OPTIONS_INVALID");
  });
  it("selects a supported ROM entry from an ordinary archive tree and retains sidecars in content identity", () => {
    const files = [file("Infinity.gb"), file("instructions.txt"), file("license.txt")];
    expect(configureRuntime({platformId: "gbc", coreIds: ["gambatte", "mgba"], files}).content)
      .toEqual({kind: "SINGLE_FILE", entryFile: "Infinity.gb"});
    expect(configureRuntime({platformId: "nes", coreIds: ["fceumm"], files: [file("game.nes"), file("README.md")]}).content)
      .toEqual({kind: "SINGLE_FILE", entryFile: "game.nes"});
    expect(() => configureRuntime({platformId: "gbc", coreIds: ["gambatte"], files: [...files, file("other.gbc")]}))
      .toThrow("RUNTIME_ENTRY_REQUIRED");
    const prepared = prepareRuntime({directory: {platformId: "gbc", defaultCoreId: "gambatte", allowedCoreIds: ["gambatte"]},
      config: {content: {kind: "SINGLE_FILE", entryFile: "Infinity.gb"}}, files, fingerprints: {"emulatorjs/gambatte": fingerprint}});
    expect(prepared.romHash).toBe(contentHash(files, "TREE"));
  });
  it("constructs a unique arcade child with the declared parents for each selected core", () => {
    const machine = (parent: string | null) => ({parent, bios: false, roms: []});
    const input = {platformId: "arcade", coreIds: ["fbneo", "fbalpha2012_cps1"],
      files: [file("1941j.zip"), file("1941.zip"), file("other-parent.zip"), file("README.txt")],
      arcadeCatalogs: {fbneo: {"1941j": machine("1941"), "1941": machine(null)},
        fbalpha2012_cps1: {"1941j": machine("other-parent"), "other-parent": machine(null)}}};
    expect(configureRuntime(input)).toEqual({content: {kind: "ARCADE", entryFile: "1941j.zip"},
      cores: {fbneo: {parentFiles: ["1941.zip"]}, fbalpha2012_cps1: {parentFiles: ["other-parent.zip"]}}});
    expect(() => configureRuntime({...input, files: [...input.files, file("unrelated.zip")]})).toThrow("RUNTIME_ENTRY_REQUIRED");
    expect(configureRuntime({...input, selection: {entryFile: "1941.zip"}}).content).toMatchObject({entryFile: "1941.zip"});
    expect(configureRuntime({...input, files: [file("1941j.zip")]})).toEqual({content: {kind: "ARCADE", entryFile: "1941j.zip"}});
  });
  it("inspects save-list identity without consulting playable archive, BIOS or resource assembly inputs", () => {
    const request = {directory: {platformId: "arcade", defaultCoreId: "fbneo", allowedCoreIds: ["fbneo"]},
      fingerprints: {"emulatorjs/fbneo": fingerprint}, files: [file("clone.zip")],
      config: {content: {kind: "ARCADE", entryFile: "clone.zip"}}};
    for (const field of ["archives", "arcadeCatalog", "cueFiles"]) {
      Object.defineProperty(request, field, {get() {throw new Error("PLAYABLE_RESOURCE_ASSEMBLY_FOR_LIST");}});
    }
    expect(inspectRuntimeIdentity(request)).toMatchObject({coreId: "fbneo", coreFingerprint: fingerprint,
      romHash: sha, readFormats: ["emulatorjs-state-v1-storage-v1"]});
  });
  it("plans complete MKXP projects, normalized directory trees and the ordinary DOS archive", () => {
    const prepare = (platformId: string, coreId: string, targetId: string, files: RuntimeContentFile[], content: object) => prepareRuntime({
      directory: {platformId, defaultCoreId: coreId, allowedCoreIds: [coreId]}, files, config: {content}, fingerprints: {[`retrom-runtime/${targetId}`]: fingerprint},
    });
    const xp = prepare("rpgmaker", "rpgmaker", "rpgmaker-xp", [file("project/Game.ini"), file("project/Data/Map.rxdata")],
      {kind: "RPG_MAKER_PROJECT", engine: "RPGXP", entryFile: "project/Game.ini"});
    expect(xp.resources[0]).toMatchObject({kind: "SEEKABLE_BLOB", encoding: "ZIP", files: ["project/Game.ini", "project/Data/Map.rxdata"],
      paths: {"project/Game.ini": "Game.ini", "project/Data/Map.rxdata": "Data/Map.rxdata"}});
    const cave = prepare("cavestory", "nxengine", "nxengine", [file("CaveStory/Doukutsu.exe"), file("CaveStory/data/Stage.dat")],
      {kind: "NXENGINE_PROJECT", entryFile: "CaveStory/Doukutsu.exe"});
    expect(cave.resources[0].paths).toEqual({"CaveStory/Doukutsu.exe": "Doukutsu.exe", "CaveStory/data/Stage.dat": "data/Stage.dat"});
  });
  it("constructs ordinary ROM and project configs from runtime-owned evidence", () => {
    expect(configureRuntime({platformId: "nes", coreIds: ["fceumm"], files: [file("game.nes")]})).toEqual({content: {kind: "SINGLE_FILE", entryFile: "game.nes"}});
    expect(configureRuntime({platformId: "cavestory", coreIds: ["nxengine"], files: [file("Doukutsu.exe"), file("data/Stage.dat")]}).content)
      .toEqual({kind: "NXENGINE_PROJECT", entryFile: "Doukutsu.exe"});
    expect(configureRuntime({platformId: "butterscotch", coreIds: ["butterscotch"], files: [file("data.win"), file("options.ini"), file("helper.js")]}).content)
      .toEqual({kind: "BUTTERSCOTCH_PROJECT", entryFile: "data.win"});
    expect(configureRuntime({platformId: "kirikiri", coreIds: ["kirikiri2"], files: [file("data.xp3"), file("patch.xp3")]}).content)
      .toEqual({kind: "KIRIKIRI_PROJECT", entryFile: "data.xp3"});
    expect(configureRuntime({platformId: "ons", coreIds: ["onscripter_yuri"], files: [file("0.txt"), file("1.txt"), file("00.txt")]}).content)
      .toEqual({kind: "ONS_PROJECT", entryFile: "0.txt"});
  });
  it("projects a nested KiriKiri startup archive into the same paths as its public file tree", () => {
    const entryFile = "nested/project/data.xp3";
    const prepared = prepareRuntime({
      directory: {platformId: "kirikiri", defaultCoreId: "kirikiri2", allowedCoreIds: ["kirikiri2"]},
      files: [file(entryFile), file("nested/project/patch.xp3")],
      config: {content: {kind: "KIRIKIRI_PROJECT", entryFile}},
      fingerprints: {"retrom-runtime/kirikiri2-kag": fingerprint},
    });
    expect(prepared.targetOptions.startupXp3Path).toBe("data.xp3");
    expect(prepared.resources[0].entryFile).toBe(prepared.targetOptions.startupXp3Path);
    expect(prepared.resources[0].paths).toEqual({[entryFile]: "data.xp3", "nested/project/patch.xp3": "patch.xp3"});
  });
  it("imports a DOS bundle with several programs for native menu selection without inventing an entry", () => {
    const input = {platformId: "dos", coreIds: ["dosbox_pure"], files: [file("game.zip")],
      archiveMembers: {"game.zip": ["GAME.EXE", "SETUP.EXE", "START.BAT"]}};
    const config = configureRuntime(input);
    expect(config.content).toEqual({kind: "DOS_BUNDLE", entryFile: "game.zip"});
    expect(parseRuntimeConfiguration(config)).toEqual(config);
    const request = {directory: {platformId: "dos", defaultCoreId: "dosbox_pure", allowedCoreIds: ["dosbox_pure"]},
      config, files: input.files, fingerprints: {"emulatorjs/dosbox-pure": fingerprint}};
    expect(prepareRuntime(request).targetOptions.dosEntryPath).toBeNull();
    expect(configureRuntime({...input, selection: {entryPath: "START.BAT"}}).content)
      .toEqual({kind: "DOS_BUNDLE", entryFile: "game.zip", entryPath: "START.BAT"});
    expect(() => configureRuntime({...input, selection: {entryPath: "MISSING.EXE"}})).toThrow("RUNTIME_DOS_ENTRY_INVALID");
    for (const entryPath of [null, ""]) {
      expect(() => parseRuntimeConfiguration({content: {kind: "DOS_BUNDLE", entryFile: "game.zip", entryPath}})).toThrow();
    }
  });
  it("shares safe unique sorted DOS program paths with configuration without flattening directories", () => {
    const entries = ["nested/Game.EXE", "START.BAT", "nested/Game.EXE", "command.com", "路径/运行.eXe", "readme.txt",
      "/absolute.exe", "../escape.bat", "bad\\game.com", "folder/../game.exe", "nul\u0000.exe"];
    expect(dosEntryCandidates(entries)).toEqual(["START.BAT", "command.com", "nested/Game.EXE", "路径/运行.eXe"]);
    const config = configureRuntime({platformId: "dos", coreIds: ["dosbox_pure"], files: [file("game.zip")],
      archiveMembers: {"game.zip": ["nested/START.BAT", "nested/START.BAT", "readme.txt"]}});
    expect(config.content).toEqual({kind: "DOS_BUNDLE", entryFile: "game.zip", entryPath: "nested/START.BAT"});
  });
  it("requires the actual PSX disc region's BIOS and exposes all regions for unidentified containers", () => {
    const input = {providerId: "emulatorjs", targetId: "mednafen-psx-hw", files: [file("disc.cue")],
      config: parseRuntimeConfiguration({content: {kind: "SINGLE_FILE", entryFile: "disc.cue"}})};
    const us = resolveBIOSRequirements({...input, firmwareEvidence: {psxRegion: "US"}});
    expect(us.map(item => item.logicalName)).toEqual(["scph5501.bin"]);
    expect(us[0].required).toBe(true);
    expect(resolveBIOSRequirements({...input, firmwareEvidence: {psxRegion: "EU"}}).map(item => item.logicalName))
      .toEqual(["scph5502.bin"]);
    const unknown = resolveBIOSRequirements(input);
    expect(unknown.map(item => item.logicalName)).toEqual(["scph5500.bin", "scph5501.bin", "scph5502.bin"]);
    expect(unknown.every(item => !item.required)).toBe(true);
  });
  it("declares a selected web bridge so the host does not branch on an engine or target", () => {
    const prepared = prepareRuntime({directory: {platformId: "tyranoscript", defaultCoreId: "tyranoscript", allowedCoreIds: ["tyranoscript"]},
      config: {content: {kind: "TYRANOSCRIPT_PROJECT", entryFile: "index.html"}}, files: [file("index.html")],
      fingerprints: {"retrom-runtime/tyranoscript": fingerprint}});
    expect(prepared.resources[0].bridgeAssetPath).toBe("assets/tyranoscript/bridge.js");
  });
  it("resolves RPG Maker actual implementations from seven engine facts", () => {
    const ini = configureRuntime({platformId: "rpgmaker", coreIds: ["rpgmaker"], files: [file("Game.ini")],
      evidence: {"Game.ini": {text: "[Game]\nScripts=Data/Scripts.rvdata2\nLibrary=RGSS301.dll\n"}}});
    expect(ini.content).toEqual({kind: "RPG_MAKER_PROJECT", entryFile: "Game.ini", engine: "RPGVXACE"});
    for (const [core, engine] of [["rpg_core", "RPGMV"], ["rmmz_core", "RPGMZ"]]) {
      expect(configureRuntime({platformId: "rpgmaker", coreIds: ["rpgmaker"], files: [file("index.html"), file(`js/${core}.js`)]}).content)
        .toEqual({kind: "RPG_MAKER_PROJECT", entryFile: "index.html", engine});
    }
  });
  it("separates strict save identity from deployment URLs and restores only the frozen core and content", () => {
    const current = {coreId: "fceumm", providerId: "emulatorjs", targetId: "fceumm", coreFingerprint: fingerprint, romHash: sha};
    const context = {...current, checkpointFormat: "state-storage-v1", runtimeOptions: {}, content: {kind: "SINGLE_FILE" as const, entryFile: "game.nes"}};
    const input = {gameAvailable: true, saveAvailable: true, current, context, readFormats: [context.checkpointFormat]};
    expect(restorability(input)).toEqual({restorable: true, reason: null});
    expect(restorability({...input, current: {...current, coreFingerprint: sha}}).reason).toBe("CORE_CHANGED");
    expect(restorability({...input, current: {...current, romHash: fingerprint}}).reason).toBe("CONTENT_CHANGED");
    expect(restorability({...input, current: null}).reason).toBe("CORE_UNAVAILABLE");
  });
  it("checks real parent requirements even when configuration omits all parents, and accepts merged sets", () => {
    const config = parseRuntimeConfiguration({content: {kind: "ARCADE", entryFile: "clone.zip"}});
    const catalog = {clone: {parent: "base", bios: false, roms: [{name: "base.bin", size: "3", crc: "11223344", merge: "base.bin"}]},
      base: {parent: null, bios: false, roms: [{name: "base.bin", size: "3", crc: "11223344"}]}};
    expect(arcadeDependencies("fbneo", config, [file("clone.zip")], {"clone.zip": []}, catalog).missingParents).toEqual(["base"]);
    expect(arcadeDependencies("fbneo", config, [file("clone.zip")], {"clone.zip": [{name: "base.bin", sizeBytes: 3, crc32: "11223344"}]}, catalog).missingParents).toEqual([]);
  });
  it("shares only explicitly declared firmware keys and identifies immutable bytes", () => {
    const requirements = biosCatalog();
    const shared = requirements.filter(item => item.logicalName === "gb_bios.bin");
    expect(new Set(shared.map(item => item.requirementKey)).size).toBe(1);
    const requirement = requirements.find(item => item.md5 && item.sizeBytes)!;
    expect(identifyBIOSFile({sizeBytes: requirement.sizeBytes!, md5: requirement.md5!, sha256: requirement.sha256 ?? sha}, [requirement])).toEqual([requirement]);
  });
  it("projects relative firmware paths while retaining the declared core filesystem location", () => {
    expect(biosCatalog().find(item => item.coreId === "flycast" && item.logicalName === "dc_boot.bin")?.virtualPath)
      .toBe("dc/dc_boot.bin");
    expect(biosCatalog().find(item => item.coreId === "gam4980" && item.logicalName === "8.BIN")?.virtualPath)
      .toBe("gam4980/8.BIN");
    expect(biosCatalog().every(item => item.virtualPath === null || !item.virtualPath.startsWith("/"))).toBe(true);
  });
  it("allows ProSystem content without its optional boot BIOS", () => {
    const prepared = prepareRuntime({directory: {platformId: "atari7800", defaultCoreId: "prosystem", allowedCoreIds: ["prosystem"]},
      fingerprints: {"emulatorjs/prosystem": fingerprint}, config: {content: {kind: "SINGLE_FILE", entryFile: "game.a78"}},
      files: [file("game.a78")]});
    expect(prepared.biosRequirements).toEqual([expect.objectContaining({coreId: "prosystem",
      logicalName: "7800 BIOS (U).rom", required: false, delivery: "BIOS_BUNDLE"})]);
  });
  it("prepares complete explicit checkpoint semantics for instant and native saves", () => {
    expect(prepareRuntime({directory, fingerprints, config: {content: {kind: "SINGLE_FILE", entryFile: "game.nes"}},
      files: [file("game.nes")]}).checkpoint?.semantics).toBe("INSTANT");
    expect(prepareRuntime({directory: {platformId: "tic80", defaultCoreId: "tic80", allowedCoreIds: ["tic80"]},
      fingerprints: {"retrom-runtime/tic80": fingerprint}, config: {content: {kind: "SINGLE_FILE", entryFile: "game.tic"}},
      files: [file("game.tic")]}).checkpoint?.semantics).toBe("GAME_SAVE");
  });
  it("accepts split inherited members across child and parent and retains loader-required parent archives", () => {
    const config = parseRuntimeConfiguration({content: {kind: "ARCADE", entryFile: "clone.zip"},
      cores: {fbneo: {parentFiles: ["base.zip"]}, fbalpha2012_cps2: {parentFiles: ["base.zip"]}}});
    const roms = [{name: "a.bin", size: "3", crc: "11223344", merge: "a.bin"},
      {name: "b.bin", size: "4", crc: "55667788", merge: "b.bin"}];
    const catalog = {clone: {parent: "base", bios: false, roms}, base: {parent: null, bios: false, roms}};
    const child = {name: "a.bin", sizeBytes: 3, crc32: "11223344"};
    const parent = {name: "b.bin", sizeBytes: 4, crc32: "55667788"};
    expect(arcadeDependencies("fbneo", config, [file("clone.zip"), file("base.zip")],
      {"clone.zip": [child], "base.zip": [parent]}, catalog)).toMatchObject({parentFiles: ["base.zip"], missingParents: []});
    const merged = {"clone.zip": [child, parent], "base.zip": []};
    expect(arcadeDependencies("fbneo", config, [file("clone.zip"), file("base.zip")], merged, catalog).parentFiles).toEqual([]);
    expect(arcadeDependencies("fbalpha2012_cps2", config, [file("clone.zip"), file("base.zip")], merged, catalog).parentFiles).toEqual(["base.zip"]);
    expect(arcadeDependencies("fbalpha2012_cps2", config, [file("clone.zip")], merged, catalog).missingParents).toEqual(["base"]);
  });
});
