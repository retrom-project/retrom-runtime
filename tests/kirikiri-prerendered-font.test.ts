// @vitest-environment node
import {describe, expect, it} from "vitest";
import {validPrerenderedFont} from "../scripts/kirikiri/prerendered-font.mjs";

/** Tiny generated glyphs and indexes; no original font data. */
function font(version = 1): Buffer {
  const bytes = Buffer.alloc(112);
  bytes.write("TVP pre-rendered font\x1a", 0, "ascii"); bytes[22] = version; bytes[23] = 2;
  bytes.writeUInt32LE(3, 24); bytes.writeUInt32LE(44, 28); bytes.writeUInt32LE(52, 32);
  bytes.set(version === 1 ? [0x11, 0x43, 0x22, 0x41] : [0x11, 0x41, 3, 0x22], 36);
  for (let i = 0; i < 3; i++) {bytes.writeUInt16LE(0x41 + i, 44 + i * 2);}
  bytes.writeUInt32LE(36, 52); bytes.writeUInt16LE(2, 56); bytes.writeUInt16LE(2, 58);
  bytes.writeUInt32LE(version === 1 ? 38 : 39, 72); bytes.writeUInt16LE(version === 1 ? 2 : 1, 76); bytes.writeUInt16LE(1, 78);
  // Reserved values are not interpreted by either native reader.
  bytes.writeUInt16LE(0xf00d, 70);
  return bytes;
}

describe("complete prerendered-font representation", () => {
  it.each([0, 1])("validates every glyph and retains source bytes for version %i", version => {
    const bytes = font(version), original = Buffer.from(bytes);
    expect(validPrerenderedFont(bytes)).toBe(true); expect(bytes).toEqual(original);
  });
  it.each(["signature", "version", "characterWidth", "count", "characterRange", "recordRange", "characterOrder",
    "glyphRange", "overlap", "runBeforeLiteral", "truncatedRun", "runOverflow", "glyphPadding", "indexPadding", "trailingBytes"])("rejects %s", defect => {
    let bytes = font();
    if (defect === "signature") {bytes[0] ^= 1;}
    if (defect === "version") {bytes[22] = 2;}
    if (defect === "characterWidth") {bytes[23] = 1;}
    if (defect === "count") {bytes.writeUInt32LE(65537, 24);}
    if (defect === "characterRange") {bytes.writeUInt32LE(111, 28);}
    if (defect === "recordRange") {bytes.writeUInt32LE(48, 32);}
    if (defect === "characterOrder") {bytes.writeUInt16LE(0x41, 46);}
    if (defect === "glyphRange") {bytes.writeUInt32LE(44, 52);}
    if (defect === "overlap") {bytes.writeUInt32LE(37, 72);}
    if (defect === "runBeforeLiteral") {bytes[36] = 0x41;}
    if (defect === "truncatedRun") {bytes.writeUInt16LE(3, 56);}
    if (defect === "runOverflow") {bytes[37] = 0x44;}
    if (defect === "glyphPadding") {bytes[40] = 1;}
    if (defect === "indexPadding") {bytes[50] = 1;}
    if (defect === "trailingBytes") {bytes = Buffer.concat([bytes, Buffer.from([0])]);}
    expect(validPrerenderedFont(bytes)).toBe(false);
  });
  it("bounds expanded glyph size and encoded file size", () => {
    const bytes = font(); bytes.writeUInt16LE(65535, 56); bytes.writeUInt16LE(65535, 58);
    expect(validPrerenderedFont(bytes)).toBe(false);
    expect(validPrerenderedFont(Buffer.alloc(32 * 1024 * 1024 + 1))).toBe(false);
    expect(validPrerenderedFont(Buffer.alloc(0))).toBe(false);
  });
});
