import {describe, expect, it} from "vitest";

import {projectProviderManifest} from "../../provider/manifest.js";
import {validateProviderManifest} from "../../provider/contract.js";
import {emulatorJsProviderDefinition} from "./catalog.js";

describe("EmulatorJS Provider declarations", () => {
  it("uses last declaration wins for exactly thirty-five current core targets", () => {
    const manifest = projectProviderManifest(emulatorJsProviderDefinition);
    expect(validateProviderManifest(manifest)).toBe(manifest);
    expect(manifest.providerId).toBe("emulatorjs");
    expect(manifest.providerVersion).toBe("1.0.0");
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
    expect(yabause?.implementation.contentKinds).toEqual(["SINGLE_FILE", "MULTI_DISC_M3U_V1"]);
    expect(yabause?.inputs.map((input) => input.kind)).toEqual([
      "ROM_BLOB_V1", "BIOS_BUNDLE_V1", "PARENT_ARCHIVE_V1", "MULTI_DISC_V1",
      "EXTERNAL_FILE_SET_V1",
    ]);
    expect(yabause?.discSwitch).toBe(true);
    expect(fceumm?.netplayPort).toBe(true);
  });
});
