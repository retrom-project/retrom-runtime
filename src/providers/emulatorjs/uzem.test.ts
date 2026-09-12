import {describe, expect, it} from "vitest";
import {createRetromDefaultControls, emulatorControlScheme} from "./default-controls.js";
import {emulatorJsProviderDefinition} from "./catalog.js";

describe("Uzebox cartridge runtime", () => {
  it("uses a complete SNES pad table with independent keyboard controls", () => {
    expect(emulatorControlScheme("uzem", "4.2.3")).toBe("snes");
    const controls = createRetromDefaultControls("uzem")[0];
    expect(controls).toMatchObject({3: {value2: "START"}, 8: {value2: "BUTTON_1"},
      6: {value2: "DPAD_LEFT"}, 7: {value2: "DPAD_RIGHT"}});
    const mapped = Object.values(controls).flatMap(control => control.value2 ? [control.value2] : []);
    expect(new Set(mapped).size).toBe(mapped.length);
  });
  it("declares a single cartridge, software core with instant checkpoints", () => {
    const target = emulatorJsProviderDefinition.targets.find(entry => entry.id === "uzem");
    expect(target).toMatchObject({discSwitch: false, netplayPort: false,
      requiresThreads: false, implementation: {runtimeCore: "uzem", contentKinds: ["SINGLE_FILE"]}});
  });
});
