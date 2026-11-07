// @vitest-environment node
import {describe, expect, it} from "vitest";
import {discoverNativeTlgProfiles, rewriteNativeTlg} from "../scripts/kirikiri/native-tlg.mjs";
import {inlineTlgPE, tlg5Pixel} from "./kirikiri-inline-fixture.js";

async function rewrite(bytes: Buffer, cuts: number[] = [bytes.length]) {
  const profiles = discoverNativeTlgProfiles(inlineTlgPE()), chunks: Buffer[] = []; let at = 0;
  for (const cut of cuts) {chunks.push(bytes.subarray(at, cut)); at = cut;}
  const output: Uint8Array[] = [];
  for await (const chunk of rewriteNativeTlg(chunks, profiles)) output.push(chunk);
  return Buffer.concat(output);
}

describe("native TLG representations", () => {
  it("recovers signatures and dimension keys through connected reader calls", () => {
    const module = inlineTlgPE(), original = Buffer.from(module);
    expect(discoverNativeTlgProfiles(module)).toEqual([
      {version: 5, signature: Buffer.from("ABCDEF\0raw\x1a", "binary").toString("hex"), widthXor: 0x1350, heightXor: 0x4689},
      {version: 6, signature: Buffer.from("UVWXYZ\0raw\x1a", "binary").toString("hex"), widthXor: 0x1350, heightXor: 0x4689}
    ]);
    expect(module).toEqual(original);
    module.writeUInt32LE(0x3125, 0x1532); module.writeUInt32LE(0x3125, 0x1729);
    expect(discoverNativeTlgProfiles(module).map(value => value.widthXor)).toEqual([0x3125, 0x3125]);
  });
  it.each([0x1307, 0x130c, 0x132c, 0x1365, 0x151e, 0x1738, 0x2806])("ignores disconnected dispatch/reader evidence at %s", at => {
    const module = inlineTlgPE(); module[at] ^= 1;
    expect(discoverNativeTlgProfiles(module)).toEqual([]);
  });
  it("canonicalizes a complete TLG5 stream across every header split without mutating source", async () => {
    const native = tlg5Pixel(true), original = Buffer.from(native);
    for (let cut = 0; cut <= native.length; cut++) expect(await rewrite(native, [cut, native.length])).toEqual(tlg5Pixel());
    expect(native).toEqual(original);
  });
  it("retains an SDS envelope and metadata while canonicalizing its TLG6 header", async () => {
    const header = Buffer.alloc(16); header[0] = 4;
    header.writeUInt32LE(17 ^ 0x1350, 4); header.writeUInt32LE(29 ^ 0x4689, 8); header.writeUInt32LE(128, 12);
    const raw = Buffer.concat([Buffer.from("UVWXYZ\0raw\x1a", "binary"), header, Buffer.alloc(64, 0x93)]);
    const wrapper = Buffer.concat([Buffer.from("TLG0.0\0sds\x1a", "binary"), Buffer.alloc(4)]); wrapper.writeUInt32LE(raw.length, 11);
    const native = Buffer.concat([wrapper, raw, Buffer.from("tags:preserved")]), expected = Buffer.from(native);
    expected.write("TLG6.0", 15); expected.writeUInt32LE(17, 30); expected.writeUInt32LE(29, 34);
    expect(await rewrite(native, Array.from({length: native.length}, (_, i) => i + 1))).toEqual(expected);
  });
  it("preserves standard/unknown resources and fails on a recognized invalid header", async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from("ABCDEF"), tlg5Pixel(), Buffer.alloc(65536, 0x82)]) expect(await rewrite(bytes)).toEqual(bytes);
    const invalid = tlg5Pixel(true); invalid.writeUInt32LE(0x1350, 12);
    await expect(rewrite(invalid)).rejects.toThrow(/ARCHIVE_INVALID/u);
  });
});
