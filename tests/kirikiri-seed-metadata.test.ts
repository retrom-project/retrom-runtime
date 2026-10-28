// @vitest-environment node
import {expect, it} from "vitest";
import {resolveSeedOnly} from "../scripts/kirikiri/resource-format.mjs";
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
