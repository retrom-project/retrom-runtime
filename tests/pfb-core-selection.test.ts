import {describe, expect, it} from "vitest";
import {selectedPfbCoreIds} from "../scripts/pfb-core-selection.mjs";

const cores = [{id: "apple2js"}, {id: "lutro"}, {id: "daphne"}, {id: "gearboy"}];

describe("PFB core candidate selection", () => {
  it("keeps the original all-core requirement unless selection is explicit", () => {
    expect([...selectedPfbCoreIds(undefined, cores)]).toEqual(cores.map((core) => core.id));
  });

  it("permits one ready core from a multi-core PFB", () => {
    expect([...selectedPfbCoreIds("gearboy", cores)]).toEqual(["gearboy"]);
  });

  it("rejects empty, unknown and duplicate selections", () => {
    for (const value of ["", "gearboy,", "unknown", "gearboy,gearboy", "../../gearboy"]) {
      expect(() => selectedPfbCoreIds(value, cores)).toThrow("PFB_CORE_SELECTION_INVALID");
    }
  });
});
