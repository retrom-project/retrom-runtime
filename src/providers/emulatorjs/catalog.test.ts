import {describe, expect, it} from "vitest";

import {projectProviderManifest} from "../../provider/manifest.js";
import {validateProviderManifest} from "../../provider/contract.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {emulatorJsNetplayProfiles} from "./netplay-profile.js";

describe("EmulatorJS Provider declarations", () => {
  it("uses last declaration wins for exactly thirty-five current core targets", () => {
    const manifest = projectProviderManifest(emulatorJsProviderDefinition);
    expect(validateProviderManifest(manifest)).toBe(manifest);
    expect(manifest.providerId).toBe("emulatorjs");
    expect(manifest.providerVersion).toBe("2.2.0");
    expect(manifest.targets).toHaveLength(35);
    expect(new Set(manifest.targets.map((target) => target.id)).size).toBe(35);
    for (const targetId of ["dosbox-pure", "genesis-plus-gx-wide", "azahar"]) {
      const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === targetId);
      expect(target?.implementation.release).toBe("4.3.0-pre");
    }
    expect(emulatorJsProviderDefinition.targets.find((entry) => entry.id === "dosbox-pure")?.implementation)
      .toMatchObject({artifactFlavor: "THREAD_WASM", runtimeCore: "dosbox_pure"});
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
