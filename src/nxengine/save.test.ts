import {expect, it} from "vitest";
import {decodeSave, encodeSave} from "./save.js";
const identity = "a".repeat(64);
function profile() {const bytes = new Uint8Array(0x604); bytes.set(new TextEncoder().encode("Do041220")); return bytes;}
it("transfers all native slots and refuses incompatible or corrupt data", () => {
  const files = [["profile.dat", profile()], ["profile2.dat", profile()]] as const;
  const save = encodeSave(identity, files);
  expect(decodeSave(save, identity)).toEqual(files);
  expect(() => decodeSave(save, "b".repeat(64))).toThrow("NXENGINE_SAVE_INVALID");
  expect(() => decodeSave(save.slice(0, -1), identity)).toThrow("NXENGINE_SAVE_INVALID");
  expect(() => encodeSave(identity, [])).toThrow("NXENGINE_SAVE_INVALID");
  expect(() => encodeSave(identity, [["../profile.dat", profile()]])).toThrow("NXENGINE_SAVE_INVALID");
  expect(() => encodeSave(identity, [["profile.dat", new Uint8Array(0x604)]])).toThrow("NXENGINE_SAVE_INVALID");
});
