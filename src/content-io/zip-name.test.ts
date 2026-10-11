import {expect, it} from "vitest";
import {decodeZIPName, zipNameCRC32} from "./zip-name.js";
import {gbkProgramName} from "../../tests/zip-encoding-fixture.js";

it("decodes explicit UTF-8, unmarked UTF-8, GB18030 and a CP437 accent without replacement characters", () => {
  const name = "目录/运行.exe", utf8 = new TextEncoder().encode(name);
  expect(decodeZIPName(utf8, 0x800)).toBe(name);
  expect(decodeZIPName(utf8, 0)).toBe(name);
  expect(decodeZIPName(gbkProgramName, 0)).toBe("金庸群侠传/PLAY.BAT");
  expect(decodeZIPName(Uint8Array.of(0x82, ...new TextEncoder().encode(".exe")), 0)).toBe("é.exe");
  expect(() => decodeZIPName(gbkProgramName, 0x800)).toThrow("ZIP_FILENAME_INVALID");
});

it("uses a checksum-matched Unicode path extra field and ignores stale or unsupported ones", () => {
  const name = new TextEncoder().encode("OLD.EXE"), unicode = new TextEncoder().encode("目录/运行.exe");
  const extra = new Uint8Array(9 + unicode.length), view = new DataView(extra.buffer);
  view.setUint16(0, 0x7075, true); view.setUint16(2, 5 + unicode.length, true);
  extra[4] = 1; view.setUint32(5, zipNameCRC32(name), true); extra.set(unicode, 9);
  expect(decodeZIPName(name, 0, extra)).toBe("目录/运行.exe");
  expect(decodeZIPName(name, 0x800, extra)).toBe("OLD.EXE");
  view.setUint32(5, 0, true); expect(decodeZIPName(name, 0, extra)).toBe("OLD.EXE");
  extra[4] = 2; expect(decodeZIPName(name, 0, extra)).toBe("OLD.EXE");
  expect(() => decodeZIPName(name, 0, extra.subarray(0, 7))).toThrow("ZIP_FILENAME_INVALID");
  expect(zipNameCRC32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
});
