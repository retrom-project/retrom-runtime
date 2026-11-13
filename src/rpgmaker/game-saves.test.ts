import {expect, it} from "vitest";
import {decodeRpgCheckpoint, encodeRpgCheckpoint, type RpgCheckpointEntry} from "../checkpoint.js";
import {RpgGameSaves} from "./game-saves.js";
import {rpgSaveFileSystem} from "../../tests/rpg-save-files-fixture.js";
import {installRpgSaveFiles, readRpgSaveFiles, replaceRpgSaveFiles} from "./native-files.js";

const entry = (key: string, value = 1): RpgCheckpointEntry => ({key, store: "FILESYSTEM", mediaType: "application/octet-stream", data: Uint8Array.of(value)});
it.each(["RPG2000", "RPG2003", "RPGXP", "RPGVX", "RPGVXAce", "RPGMV", "RPGMZ"] as const)(
  "%s round-trips all native entries in canonical order with no automatic resume slot", async engine => {
  const files = [entry("日本語/進捗.dat"), entry("a.dat"), entry("A.dat"), entry("settings.dat")];
  const decoded = await decodeRpgCheckpoint(await encodeRpgCheckpoint({engine, entries: files}), engine);
  expect(decoded.entries.map(file => file.key)).toEqual(["A.dat", "a.dat", "settings.dat", "日本語/進捗.dat"]);
  expect(decoded).not.toHaveProperty("resumeSlot");
});

it("retains the previous progress screenshot for settings-only exports and acknowledges only the exported revision", async () => {
  const files = [entry("Save01.lsd")];
  const saves = new RpgGameSaves("RPG2000", () => files, null, file => file.key.endsWith('.lsd'));
  const initial = await saves.capture(); expect(initial.screenshot).toBeUndefined();
  await saves.acknowledge(initial.bytes);
  files.push(entry("settings.ini"));
  const settings = await saves.capture(); expect(settings.screenshot).toBe("UNCHANGED");
  files[0] = entry("Save01.lsd", 2);
  await saves.acknowledge(settings.bytes);
  expect(saves.availability()).toMatchObject({available: true});
  expect((await saves.capture()).screenshot).toBeUndefined();
});

it("classifies restored progress with the same engine identity used after database loading", async () => {
  let ready = false;
  const files = [entry("slot1")];
  const saves = new RpgGameSaves("RPGMV", () => files, {engine: "RPGMV", entries: [...files]},
    file => ready && file.key === "slot1");
  ready = true;
  files.push(entry("config"));
  expect((await saves.capture()).screenshot).toBe("UNCHANGED");
});

it("imports all nested native files before use and preserves their exact bytes", () => {
  const {fs} = rpgSaveFileSystem();
  const files = [entry("Title/Save01.rvdata2", 1), entry("Title/shared/flags.dat", 2)];
  installRpgSaveFiles(fs, "/save", files);
  expect(readRpgSaveFiles(fs, "/save")).toEqual(files);
});

it("reads native directories on WasmFS without the MEMFS-only directory helpers", () => {
  const {fs} = rpgSaveFileSystem();
  installRpgSaveFiles(fs, "/save", [entry("Title/Save01.rxdata")]);
  Object.defineProperty(fs, "analyzePath", {value: () => {throw Object.assign(Error("EISDIR"), {errno: 31});}});
  Object.defineProperty(fs, "isDir", {value: undefined});
  expect(readRpgSaveFiles(fs, "/save")).toEqual([entry("Title/Save01.rxdata")]);
});

it("replaces later files and directories before importing the selected native save", () => {
  const {fs, directories} = rpgSaveFileSystem();
  installRpgSaveFiles(fs, "/save", [entry("slot/old.dat"), entry("Save02.lsd")]);
  fs.mkdirTree("/save/empty/nested");
  replaceRpgSaveFiles(fs, "/save", [entry("slot", 9), entry("Save01.lsd", 2)]);
  expect(readRpgSaveFiles(fs, "/save")).toEqual([entry("slot", 9), entry("Save01.lsd", 2)]);
  expect(directories).not.toContain("/save/empty");
});

it("validates a replacement before removing any current native data", () => {
  const {fs} = rpgSaveFileSystem();
  installRpgSaveFiles(fs, "/save", [entry("Save01.lsd")]);
  expect(() => replaceRpgSaveFiles(fs, "/save", [entry("../escape")])).toThrow("RPG_GAME_SAVE_INVALID");
  expect(readRpgSaveFiles(fs, "/save")).toEqual([entry("Save01.lsd")]);
});

it.each(["../escape", "/outside", "name/../outside", "folder\\outside", "bad\u0000path"])(
  "validates the entire native import before writing an unsafe path %j", key => {
  const {fs, files} = rpgSaveFileSystem();
  expect(() => installRpgSaveFiles(fs, "/save", [entry("valid.dat"), entry(key)])).toThrow("RPG_GAME_SAVE_INVALID");
  expect(files.size).toBe(0);
});
