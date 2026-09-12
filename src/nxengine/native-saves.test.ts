import {expect, it} from "vitest";
import {nativeSaves} from "./native-saves.js";
import {encodeSave} from "./save.js";

const identity = "a".repeat(64);
function profile(value = 1) {
  const bytes = new Uint8Array(0x604);
  bytes.set(new TextEncoder().encode("Do041220")); bytes[16] = value;
  return bytes;
}
function machine() {
  const files = new Map<string, Uint8Array>();
  const readFile = (path: string) => {const bytes = files.get(path); if (!bytes) {throw Error("ENOENT");} return bytes.slice();};
  return {FS: {readFile, mkdirTree() {}, writeFile(path: string, bytes: Uint8Array) {files.set(path, bytes.slice());},
    readdir() {return [...files.keys()].map((path) => path.slice(6));}, stat(path: string) {return {size: readFile(path).length};}}};
}
it("keeps a native save dirty until the host acknowledges successful persistence", () => {
  const core = machine(), saves = nativeSaves(core, identity, null);
  expect(saves.availability()).toMatchObject({available: false, blocker: "NO_SAVE"});
  core.FS.writeFile("/save/profile.dat", profile());
  const checkpoint = saves.capture();
  expect(saves.availability().available).toBe(true);
  core.FS.writeFile("/save/profile.dat", profile(2));
  saves.acknowledge(checkpoint);
  expect(saves.availability().available).toBe(true);
  saves.acknowledge(saves.capture());
  expect(saves.availability()).toMatchObject({available: false, blocker: "UNCHANGED"});
});
it("restores exact native slots only when explicitly supplied to a new instance", () => {
  const payload = encodeSave(identity, [["profile.dat", profile()], ["profile3.dat", profile(3)]]);
  const core = machine(), saves = nativeSaves(core, identity, payload);
  expect(core.FS.readdir()).toEqual([]);
  saves.importBeforeStart();
  expect(core.FS.readFile("/save/profile3.dat")).toEqual(profile(3));
  expect(saves.availability()).toMatchObject({available: false, blocker: "UNCHANGED"});
  expect(nativeSaves(machine(), identity, null).availability().blocker).toBe("NO_SAVE");
  core.FS.writeFile("/save/profile.dat", new Uint8Array(1));
  expect(saves.availability().blocker).toBe("FAILED");
  expect(() => saves.capture()).toThrow("NXENGINE_SAVE_UNAVAILABLE");
});
