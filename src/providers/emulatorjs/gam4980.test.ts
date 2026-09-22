import {describe, expect, it} from "vitest";
import {createRetromDefaultControls, emulatorControlScheme} from "./default-controls.js";
import {emulatorJsProviderDefinition} from "./catalog.js";

describe("BBK RPG runtime", () => {
  it("maps directions, native A confirm and native B cancel independently", () => {
    expect(emulatorControlScheme("gam4980", "4.2.3")).toBe("snes");
    const controls = createRetromDefaultControls("gam4980")[0];
    expect(controls).toMatchObject({
      8: {value: "k", value2: "BUTTON_1"}, 0: {value: "j", value2: "BUTTON_2"},
      4: {value: "w", value2: "DPAD_UP"}, 5: {value: "s", value2: "DPAD_DOWN"},
      6: {value: "a", value2: "DPAD_LEFT"}, 7: {value: "d", value2: "DPAD_RIGHT"},
    });
    const mapped = Object.values(controls).flatMap(control => control.value2 ? [control.value2] : []);
    expect(new Set(mapped).size).toBe(mapped.length);
  });
  it("declares a single GAM and an independent complete-state checkpoint format", () => {
    const target = emulatorJsProviderDefinition.targets.find(entry => entry.id === "gam4980");
    expect(target).toMatchObject({adapterId: "emulatorjs-gam4980", discSwitch: false,
      implementation: {runtimeCore: "gam4980", contentKinds: ["SINGLE_FILE"]}});
    const adapter = emulatorJsProviderDefinition.adapters.find(entry => entry.id === "emulatorjs-gam4980");
    expect(adapter?.capabilities.volume).toBe(true);
    expect(adapter?.checkpoint).toEqual({
      readFormats: ["gam4980-state-v1", "gam4980-state-v1-storage-v1", "gam4980-state-v2", "gam4980-state-v2-storage-v1"],
      writeFormat: "gam4980-state-v2-storage-v1",
    });
  });
});
