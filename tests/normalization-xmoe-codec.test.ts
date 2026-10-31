// @vitest-environment node
import {expect, it} from "vitest";
import {decodeXmoePayload, inspectXmoeArchive, xmoeLimits} from "../scripts/normalization/xmoe-codec.mjs";
import {archive, generatedProfile, literalLz4, marked, payload, psb, stringsOf} from "./normalization-xmoe-fixture.js";

it.each([0, 73])("decodes the companion-derived key into ordinary UTF8 PSB and preserves non-text nodes (key=%s)", salt => {
  const profile = generatedProfile(salt), before = psb(), after = decodeXmoePayload(payload(before, profile), profile);
  expect(stringsOf(after)).toEqual(["caption", "中文对白", "prefix 保留原文 suffix"]);
  expect(after.subarray(40, before.readUInt32LE(16))).toEqual(before.subarray(40, before.readUInt32LE(16)));
  expect(after.subarray(after.readUInt32LE(24))).toEqual(before.subarray(before.readUInt32LE(24)));
  expect(after.readUInt32LE(36)).toBe(before.readUInt32LE(36));
});
it("keeps literal text unchanged and decodes shared/reordered string offsets independently", () => {
  const before = psb([marked("文本"), Buffer.from("literal"), marked("文本")]);
  const p = before.readUInt32LE(16); before.writeUInt32LE(before.readUInt32LE(p + 4), p + 12);
  expect(stringsOf(decodeXmoePayload(payload(before), generatedProfile()))).toEqual(["文本", "literal", "文本"]);
});
it.each(["length", "magic", "lz4", "psbOffsets", "marker"])("rejects corrupt %s rather than leaking undecoded resources", kind => {
  const profile = generatedProfile(); let data = psb();
  if (kind === "psbOffsets") data.writeUInt32LE(data.length + 4, 20);
  if (kind === "marker") data = psb([Buffer.from("feffffff41424300", "hex")]);
  const packed = payload(data);
  if (kind === "length") packed[4] ^= 128;
  if (kind === "magic") packed[0] ^= 1;
  if (kind === "lz4") packed[8] = 0;
  expect(() => decodeXmoePayload(packed, profile)).toThrow("RUNTIME_XMOE_INVALID");
});
it("bounds declared decompression before allocating and observes cancellation", () => {
  const profile = generatedProfile(), bytes = payload(psb());
  const encoded = Buffer.alloc(4); encoded.writeUInt32LE(xmoeLimits.file + 1);
  for (let i = 0; i < 4; i++) bytes[4 + i] = encoded[i] ^ profile.key[4 + i];
  expect(() => decodeXmoePayload(bytes, profile)).toThrow("RUNTIME_XMOE_LIMIT");
  const signal = AbortSignal.abort();
  expect(() => decodeXmoePayload(payload(psb()), profile, signal)).toThrow();
});
it("does not accept a truncated or unrelated index as a matched archive", () => {
  expect(() => inspectXmoeArchive(Buffer.alloc(24), literalLz4(Buffer.alloc(4)), generatedProfile(), 32)).toThrow("RUNTIME_XMOE_INVALID");
});

it.each([0, 73])("validates metadata with native UTF16 name hashes and companion-derived header keys (salt=%s)", salt => {
  const built = archive({salt});
  expect(inspectXmoeArchive(built.header, built.index, built.profile, built.bytes.length)).toEqual([{name: "intro.ks.scn", offset: 24, packed: built.content.length}]);
});
it.each(["duplicate", "invalidName", "badHash"] as const)("rejects recognized %s metadata", property => {
  const built = archive({[property]: true});
  expect(() => inspectXmoeArchive(built.header, built.index, built.profile, built.bytes.length)).toThrow(property === "invalidName" ? "RUNTIME_XMOE_PATH_INVALID" : "RUNTIME_XMOE_INVALID");
});
it("rejects ranges beyond the immutable source and truncated/inconsistent Huffman metadata", () => {
  const built = archive();
  expect(() => inspectXmoeArchive(built.header, built.index, built.profile, built.bytes.length - 1)).toThrow("RUNTIME_XMOE_INVALID");
  built.index[0] = 255;
  expect(() => inspectXmoeArchive(built.header, built.index, built.profile, built.bytes.length)).toThrow("RUNTIME_XMOE_INVALID");
});
it("decodes LZ4 overlapping matches rather than requiring literal-only packets", () => {
  const original = psb([Buffer.from("AAAAAAAAAA")]), encoded = literalLz4(original), location = original.indexOf("AAAAAAAAAA"), cut = 1 + (original.length >= 15 ? Math.floor((original.length - 15) / 255) + 1 : 0);
  const prefix = original.subarray(0, location + 1), first = literalLz4(prefix); first[0] |= 5;
  const suffix = literalLz4(original.subarray(location + 10)), compressed = Buffer.concat([first, Buffer.from([1, 0]), suffix]);
  expect(encoded.length - cut).toBe(original.length);
  const header = Buffer.alloc(8), profile = generatedProfile(); header.writeUInt32LE(profile.payloadMagic); header.writeUInt32LE(original.length, 4);
  const bytes = Buffer.from(Buffer.concat([header, compressed]).map((x, i) => x ^ profile.key[i & 1023]));
  expect(stringsOf(decodeXmoePayload(bytes, profile))).toEqual(["AAAAAAAAAA"]);
});

it("preserves a zero encrypt-data offset in unencrypted PSB v2", () => {
  const before = psb(); before.writeUInt32LE(0, 8); const after = decodeXmoePayload(payload(before), generatedProfile());
  expect(after.readUInt32LE(8)).toBe(0); expect(stringsOf(after)[1]).toBe("中文对白");
});
