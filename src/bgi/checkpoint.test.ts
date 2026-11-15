import {expect, it} from "vitest";
import {decodeBgiSave, encodeBgiSave, type BgiSnapshot} from "./checkpoint.js";
const identity = "a".repeat(64);
const snapshot = (): BgiSnapshot => ({format: "bgi-save-files", version: 1, scope: identity, files: [
  {path: "userdata/bgi0000.cad", data: btoa("p".repeat(128))}, {path: "userdata/bgi0000.cad.png", data: "UE5H"},
]});
it("round-trips bounded native save files, and thumbnails without adapter compression", () => {
  const encoded = encodeBgiSave(snapshot(), identity);
  expect(encoded[0]).toBe(123);
  expect(decodeBgiSave(encoded, identity)).toEqual(snapshot());
});
it("round-trips numbered native SUD slots while rejecting settings-only files", () => {
  const value = {...snapshot(), files: [{path: "userdata/story001.sud", data: btoa("p".repeat(128))}]};
  expect(decodeBgiSave(encodeBgiSave(value, identity), identity)).toEqual(value);
  expect(() => encodeBgiSave({...value, files: [{...value.files[0], path: "userdata/config.sud"}]}, identity)).toThrow("BGI_NO_SAVE");
});
it.each([64, 65, 66, 67])("uses the decoded slot length at the native %i-byte boundary", size => {
  const value = {...snapshot(), files: [{path: "bgi0000.cad", data: btoa("p".repeat(size))}]};
  if (size === 64) {expect(() => encodeBgiSave(value, identity)).toThrow("BGI_NO_SAVE");}
  else {expect(decodeBgiSave(encodeBgiSave(value, identity), identity)).toEqual(value);}
});
it("rejects foreign identities, malformed input, duplicate/traversing paths and settings-only archives", () => {
  const bytes = encodeBgiSave(snapshot(), identity);
  expect(() => decodeBgiSave(bytes, "other")).toThrow("BGI_CHECKPOINT_INVALID");
  expect(() => decodeBgiSave(new Uint8Array([0xff]), identity)).toThrow("BGI_CHECKPOINT_INVALID");
  for (const files of [[{path: "../savedata/0.sav", data: "AA=="}],
    [{path: "savedata/0.sav", data: "AA=="}, {path: "savedata/0.sav", data: "AA=="}],
    [{path: "savedata/0.sav", data: "a*=="}]]) {
    expect(() => encodeBgiSave({...snapshot(), files}, identity)).toThrow("BGI_CHECKPOINT_INVALID");
  }
  expect(() => encodeBgiSave({...snapshot(), files: [{path: "savedata/config.sav", data: "AA=="}]}, identity)).toThrow("BGI_NO_SAVE");
});
