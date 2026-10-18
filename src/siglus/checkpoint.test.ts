import {expect, it} from "vitest";
import {decodeSiglusSave, encodeSiglusSave, type SiglusSnapshot} from "./checkpoint.js";
const identity = "a".repeat(64) + ":chs";
const snapshot = (): SiglusSnapshot => ({format: "siglus-save-files", version: 1, scope: identity, files: [
  {path: "savedata/0000.sav", data: "AP+A"}, {path: "savedata/0000.sav.png", data: "UE5H"},
  {path: "savedata/old.sav", data: null},
]});
it("round-trips actual native save bytes, thumbnails and deletion markers without adapter compression", () => {
  const encoded = encodeSiglusSave(snapshot(), identity);
  expect(encoded[0]).toBe(123);
  expect(decodeSiglusSave(encoded, identity)).toEqual(snapshot());
});
it("rejects foreign identities, malformed input, duplicate/traversing paths and settings-only archives", () => {
  const bytes = encodeSiglusSave(snapshot(), identity);
  expect(() => decodeSiglusSave(bytes, "other")).toThrow("SIGLUS_CHECKPOINT_INVALID");
  expect(() => decodeSiglusSave(new Uint8Array([0xff]), identity)).toThrow("SIGLUS_CHECKPOINT_INVALID");
  for (const files of [[{path: "../savedata/0.sav", data: "AA=="}],
    [{path: "savedata/0.sav", data: "AA=="}, {path: "savedata/0.sav", data: "AA=="}],
    [{path: "savedata/0.sav", data: "a*=="}]]) {
    expect(() => encodeSiglusSave({...snapshot(), files}, identity)).toThrow("SIGLUS_CHECKPOINT_INVALID");
  }
  expect(() => encodeSiglusSave({...snapshot(), files: [{path: "savedata/config.sav", data: "AA=="}]}, identity)).toThrow("SIGLUS_NO_SAVE");
});
