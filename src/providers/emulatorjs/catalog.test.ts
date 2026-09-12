import {describe, expect, it} from "vitest";

import {projectProviderManifest} from "../../provider/manifest.js";
import {validateProviderManifest} from "../../provider/contract.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {emulatorJsNetplayProfiles} from "./netplay-profile.js";

describe("EmulatorJS Provider declarations", () => {
  it("declares NeoCD with upstream load options and bounded single-disc storage", () => {
    const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === "neocd")!;
    expect(target.inputs.find(input => input.role === "game")?.kind).toBe("SEEKABLE_BLOB");
    expect(target.implementation).toMatchObject({runtimeCore: "neocd", contentKinds: ["SINGLE_FILE"],
      defaultOptions: {neocd_region: "Japan", neocd_cdspeedhack: "On", neocd_loadskip: "On"}});
    const manifest = projectProviderManifest(emulatorJsProviderDefinition).targets.find((entry) => entry.id === "neocd")!;
    expect(manifest.checkpoint?.writeFormat).toBe("emulatorjs-state-v1-storage-v1");
    expect(manifest.capabilities).toMatchObject({standardGamepad: true, pause: true, screenshot: true,
      discSwitch: false, requiresThreads: false, netplayPort: false});
  });

  it("gives Flycast a bounded, distinct instant checkpoint contract and single-disc target", () => {
    const manifest = projectProviderManifest(emulatorJsProviderDefinition);
    const target = manifest.targets.find((entry) => entry.id === "flycast")!;
    expect(target.checkpoint).toEqual({maxBytes: 268435456,
      readFormats: ["flycast-state-gzip-v1", "flycast-state-v1", "flycast-state-v1-storage-v1"], writeFormat: "flycast-state-v1-storage-v1"});
    expect(target.capabilities).toMatchObject({standardGamepad: true, pause: true, screenshot: true,
      discSwitch: false, requiresThreads: false, netplayPort: false});
  });
  it("limits PSP output and writes compressed states while retaining raw saves", () => {
    const manifest = projectProviderManifest(emulatorJsProviderDefinition);
    expect(manifest.targets.find((target) => target.id === "ppsspp")?.checkpoint).toMatchObject({
      writeFormat: "emulatorjs-state-v1-storage-v1", readFormats: ["emulatorjs-state-gzip-v1", "emulatorjs-state-v1", "emulatorjs-state-v1-storage-v1"],
    });
    expect(emulatorJsProviderDefinition.targets.find((target) => target.id === "ppsspp")?.implementation)
      .toMatchObject({outputSizeLimit: {width: 960, height: 544}});
    const pspAssets = emulatorJsProviderDefinition.targets.find((target) => target.id === "ppsspp")!.assetPaths;
    expect(pspAssets).toContain("assets/4.3.0-pre/data/cores/ppsspp-assets.zip");
    expect(pspAssets).toContain("assets/4.3.0-pre/data/compression/extractzip.js");
    for (const target of manifest.targets.filter((target) => !["ppsspp", "flycast", "bsnes"].includes(target.id))) {
      expect(target.checkpoint?.writeFormat).toBe("emulatorjs-state-v1-storage-v1");
    }
  });
  it("uses last declaration wins for exactly fifty-six current core targets", () => {
    const manifest = projectProviderManifest(emulatorJsProviderDefinition);
    expect(validateProviderManifest(manifest)).toBe(manifest);
    expect(manifest.providerId).toBe("emulatorjs");
    expect(manifest.providerVersion).toBe("2.14.0");
    expect(manifest.targets).toHaveLength(56);
    expect(new Set(manifest.targets.map((target) => target.id)).size).toBe(56);
    for (const targetId of ["dosbox-pure", "genesis-plus-gx-wide", "azahar", "freeintv"]) {
      const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === targetId);
      expect(target?.implementation.release).toBe("4.3.0-pre");
    }
    expect(emulatorJsProviderDefinition.targets.find((entry) => entry.id === "dosbox-pure")?.implementation)
      .toMatchObject({artifactFlavor: "THREAD_WASM", runtimeCore: "dosbox_pure"});
  });

  it("adds the eight EmulatorJS 4.2.3 cores as single-file targets", () => {
    const targetIds = [
      "fuse", "gearcoleco", "prboom", "puae", "vice-x128", "vice-x64sc", "vice-xvic", "virtualjaguar",
    ];
    for (const targetId of targetIds) {
      const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === targetId);
      expect(target, targetId).toBeDefined();
      expect(target?.implementation).toMatchObject({
        artifactFlavor: ["vice-xvic", "virtualjaguar"].includes(targetId) ? "OVERRIDE" : "WASM", contentKinds: ["SINGLE_FILE"], release: "4.2.3",
      });
      expect(target?.discSwitch, targetId).toBe(false);
      expect(target?.netplayPort, targetId).toBe(false);
      expect(target?.requiresThreads, targetId).toBe(false);
    }
    expect(emulatorJsProviderDefinition.targets.find((entry) => entry.id === "fuse")?.implementation.defaultOptions)
      .toMatchObject({keyboardInput: "enabled"});
  });

  it("keeps runtime selection private while publishing exact frame and thread contracts", () => {
    const manifest = projectProviderManifest(emulatorJsProviderDefinition);
    expect(manifest.targets.every((target) => target.capabilities.frameMode === "SAME_ORIGIN_BLANK"))
      .toBe(true);
    expect(manifest.targets.find((target) => target.id === "azahar")?.capabilities.requiresThreads).toBe(true);
    expect(manifest.targets.find((target) => target.id === "fceumm")?.capabilities.requiresThreads).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain("runtimeCore");
    expect(JSON.stringify(manifest)).not.toContain("artifactFlavor");
    expect(JSON.stringify(manifest)).not.toContain("adapterId");
  });

  it("preserves core-specific options, startup actions and content-resource lanes", () => {
    const ppsspp = emulatorJsProviderDefinition.targets.find((target) => target.id === "ppsspp");
    const yabause = emulatorJsProviderDefinition.targets.find((target) => target.id === "yabause");
    const fceumm = emulatorJsProviderDefinition.targets.find((target) => target.id === "fceumm");
    expect(ppsspp?.implementation.startupActions).toHaveLength(2);
    expect(yabause?.implementation.contentKinds).toEqual(["SINGLE_FILE", "MULTI_DISC"]);
    expect(yabause?.inputs.map((input) => input.kind)).toEqual([
      "ROM_BLOB", "BIOS_BUNDLE", "PARENT_ARCHIVE", "MULTI_DISC",
      "EXTERNAL_FILE_SET",
    ]);
    expect(yabause?.discSwitch).toBe(true);
    expect(fceumm?.netplayPort).toBe(true);
  });

  it("declares the core compatibility report that EmulatorJS loads at runtime", () => {
    for (const target of emulatorJsProviderDefinition.targets) {
      const {release, runtimeCore} = target.implementation;
      expect(target.assetPaths).toContain(`assets/${release}/data/cores/reports/${runtimeCore}.json`);
    }
  });

  it("freezes the exact eight-profile netplay policy in target declarations", () => {
    expect(emulatorJsNetplayProfiles).toEqual({
      fbalpha2012_cps1: {id: "fbalpha2012-cps1-423-v1", maxPlayers: 2, maxPredictionFrames: 0},
      fbalpha2012_cps2: {id: "fbalpha2012-cps2-423-v1", maxPlayers: 2, maxPredictionFrames: 0},
      fbneo: {id: "fbneo-423-v1", maxPlayers: 2, maxPredictionFrames: 0},
      fceumm: {id: "fceumm-423-v1", maxPlayers: 2, maxPredictionFrames: 8},
      mame2003: {id: "mame2003-423-override-v1", maxPlayers: 2, maxPredictionFrames: 0},
      mame2003_plus: {id: "mame2003-plus-423-v1", maxPlayers: 2, maxPredictionFrames: 0},
      nestopia: {id: "nestopia-423-v1", maxPlayers: 2, maxPredictionFrames: 0},
      snes9x: {id: "snes9x-423-v1", maxPlayers: 2, maxPredictionFrames: 0},
    });
    expect(Object.isFrozen(emulatorJsNetplayProfiles)).toBe(true);
    const declared = emulatorJsProviderDefinition.targets
      .filter((target) => target.netplayPort)
      .map((target) => [target.implementation.runtimeCore, target.implementation.netplayProfile?.id]);
    expect(declared).toEqual(Object.entries(emulatorJsNetplayProfiles).map(([core, profile]) => [core, profile.id]));
  });
});
