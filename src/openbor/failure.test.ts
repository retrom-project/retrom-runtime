import {expect, it} from "vitest";
import {openBORFailure} from "./failure.js";
import type {OpenBOR} from "./module.js";

const core = (text: string) => ({FS: {stat: () => ({size: text.length}), readFile: () => new TextEncoder().encode(text)}} as unknown as OpenBOR);
it.each(["Can't compile script 'keyall'", "Script compile error: SAMPLE_BEEP2", "Delay must fit the unsigned 64-bit integer range."])("classifies explicit engine content rejection: %s", text => {
  expect(openBORFailure(core(text), "OPENBOR_CORE_EXITED")).toMatchObject({category: "CONTENT", diagnostics: [text]});
});
it("preserves unknown exit and trap causes without claiming content incompatibility", () => {
  expect(openBORFailure(undefined, "OPENBOR_CORE_EXITED")).toMatchObject({category: "CORE", diagnostics: []});
  const cause = new WebAssembly.RuntimeError("out of bounds");
  expect(openBORFailure(core("normal native output"), "OPENBOR_CORE_ABORTED", cause)).toMatchObject({category: "CORE", cause});
});

it("leads with the native rejection while retaining resource and line context", () => {
 const text = "Loading fonts...Done!\nCan't find openbor constant 'SAMPLE_BEEP'\nScript compile error in 'data/scripts/test.c': line 23, column 3";
 expect(openBORFailure(core(text), "OPENBOR_CORE_EXITED").diagnostics.join("\n")).toBe(text.slice(text.indexOf("Can't find")));
});
