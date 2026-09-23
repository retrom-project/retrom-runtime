import {describe, expect, it} from "vitest";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {createRetromDefaultControls} from "./default-controls.js";
import {emulatorJsSourceCatalog} from "./source-catalog.js";

describe("O2EM cartridge runtime", () => {
  it("pins the published fork release rather than a development candidate", () => {
    expect(emulatorJsSourceCatalog.developmentForks).toEqual([]);
    expect(emulatorJsSourceCatalog.forks.find((fork) => fork.runtimeCore === "o2em"))
      .toMatchObject({repository: "https://github.com/retrom-project/libretro-o2em",
        tag: "retrom-core-g679d6fec0496-r2",
        commit: "e3583cf23d951a38a48e16a0f05279d85ac07bea",
        adapterAbi: "emulatorjs-state-v1"});
  });

  it("declares the single-file core, firmware input and instant checkpoint", () => {
    const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === "o2em");
    expect(target).toMatchObject({discSwitch: false, requiresThreads: false,
      implementation: {runtimeCore: "o2em", contentKinds: ["SINGLE_FILE"],
        defaultOptions: {keyboardInput: "enabled", o2em_bios: "o2rom.bin"}}});
    expect(target?.inputs).toContainEqual({cardinality: "ONE", kind: "BIOS_BUNDLE", optional: true, role: "bios"});
    expect(emulatorJsProviderDefinition.adapters.find((adapter) => adapter.id === target?.adapterId))
      .toMatchObject({checkpoint: {writeFormat: "emulatorjs-state-v1-storage-v1"}});
  });

  it("maps both players' direction and action to distinct standard pad inputs", () => {
    const controls = createRetromDefaultControls("o2em");
    for (const player of [0, 1]) {
      expect(controls[player]).toMatchObject({4: {value2: "DPAD_UP"},
        6: {value2: "DPAD_LEFT"}, 0: {value2: "BUTTON_1"}});
      const mapped = Object.values(controls[player] ?? {}).flatMap(({value2}) => value2 ? [value2] : []);
      expect(new Set(mapped).size).toBe(mapped.length);
    }
  });
});
