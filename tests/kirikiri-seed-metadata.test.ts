// @vitest-environment node
import {expect, it} from "vitest";
import {resolveFilteredSeed, resolveSeedOnly} from "../scripts/kirikiri/resource-format.mjs";
import {tinyPE} from "./kirikiri-pe-fixture.js";

const apply = (bytes: Buffer) => {for (let i = 0; i < bytes.length; i++) bytes[i] ^= 0x93; return bytes;};
const text = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('global.value = "独立格式证据";\r\n', "utf16le")]);
it("distinguishes clear PE and text from encrypted seed-only text using complete format evidence", () => {
  const source = apply(Buffer.from(text)), saved = Buffer.from(source);
  expect(resolveSeedOnly(source, {apply}, 0)).toEqual(text);
  expect(source).toEqual(saved);
  expect(resolveSeedOnly(tinyPE(), {apply}, 0)).toEqual(tinyPE());
  expect(resolveSeedOnly(text, {apply}, 0)).toEqual(text);
});
it("rejects ambiguous or unrecognized seed-only bytes instead of blessing arbitrary output", () => {
  expect(() => resolveSeedOnly(Buffer.from("clear ASCII text"), {apply: bytes => bytes}, 0)).not.toThrow();
  expect(() => resolveSeedOnly(Buffer.from("clear ASCII text"), {apply: bytes => {bytes[0] ^= 1;return bytes;}}, 0)).toThrow(/FILTER_AMBIGUOUS/u);
  expect(() => resolveSeedOnly(Buffer.from([0, 1, 2, 3, 4]), {apply}, 0)).toThrow(/CHECKSUM_MISMATCH/u);
  const fakePE = Buffer.alloc(90); fakePE.write("MZ");
  expect(() => resolveSeedOnly(fakePE, {apply}, 0)).toThrow(/CHECKSUM_MISMATCH/u);
});
it("preserves strict Shift-JIS text in checksum-free archives without guessing a text conversion", () => {
  const source = Buffer.concat([Buffer.from("*start|\r\n;"), Buffer.from([0x82, 0xa0, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67]), Buffer.from("\r\n[s]\r\n")]);
  const original = Buffer.from(source), encrypted = apply(Buffer.from(source));
  expect(resolveSeedOnly(source, {apply}, 0)).toEqual(original);
  expect(resolveSeedOnly(encrypted, {apply}, 0)).toEqual(original);
  expect(source).toEqual(original);
  for (const invalid of [Buffer.from([0x82]), Buffer.from([0x82, 0xa0, 0]), Buffer.from([0x82, 0x20]), Buffer.from([0x82, 0xa0])]) {
    expect(() => resolveSeedOnly(invalid, {apply: bytes => bytes}, 0)).toThrow(/CHECKSUM_MISMATCH/u);
  }
});
it("requires the filtered representation for protected seeds and rejects two distinct valid representations", () => {
  const source = Buffer.from("ordinary printable resource text");
  expect(() => resolveFilteredSeed(source, {apply}, 0)).toThrow(/CHECKSUM_MISMATCH/u);
  expect(() => resolveFilteredSeed(source, {apply: bytes => {bytes[0] ^= 1; return bytes;}}, 0)).toThrow(/FILTER_AMBIGUOUS/u);
});
