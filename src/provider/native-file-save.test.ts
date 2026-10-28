import {Buffer} from "node:buffer";
import {expect, it} from "vitest";
import * as nxengine from "../nxengine/save.js";
import * as openbor from "../openbor/save.js";
import type {SaveFile} from "./native-file-save.js";

const identity = "a".repeat(64);
const profile = new Uint8Array(0x604); profile.set(new TextEncoder().encode("Do041220"));
const variants = [
  {name: "nxengine", codec: nxengine, code: "NXENGINE_SAVE_INVALID",
    files: [["profile2.dat", profile], ["profile.dat", profile]] as SaveFile[]},
  {name: "openbor", codec: openbor, code: "OPENBOR_SAVE_INVALID",
    files: [["game.sav", Uint8Array.of(1, 2)], ["game.s00", Uint8Array.of(3)]] as SaveFile[]},
];

it.each(variants)("$name retains the exact released JSON envelope and canonical file order", ({codec, files}) => {
  const entries = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) =>
    `[${JSON.stringify(name)},${JSON.stringify(Buffer.from(bytes).toString("base64"))}]`);
  const expected = new TextEncoder().encode(`{"version":1,"identity":"${identity}","files":[${entries.join(",")}]}`);
  expect(codec.encodeSave(identity, files)).toEqual(expected);
  expect(codec.decodeSave(expected, identity)).toEqual([...files].reverse());
});

it.each(variants)("$name rejects noncanonical base64, unexpected fields, foreign identity and oversized envelopes", ({codec, code}) => {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  for (const value of [
    {version: 1, identity, files: [["game.sav", "AR=="]]},
    {version: 1, identity, files: [], extra: true},
    {version: 1, identity: "b".repeat(64), files: []},
  ]) {expect(() => codec.decodeSave(encode(value), identity)).toThrow(code);}
  expect(() => codec.decodeSave(new Uint8Array(codec.maximumSaveBytes + 1), identity)).toThrow(code);
  expect(() => codec.decodeSave(Uint8Array.of(0xff), identity)).toThrow(code);
});
