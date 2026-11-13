import {Buffer} from "node:buffer";
import {tinyPE} from "./kirikiri-pe-fixture.ts";

/** Synthetic callback ABI and API-resolution relationships; no private module bytes. */
export function prefixPE(shift = 9, boundary = 11) {
  const bytes = tinyPE(); bytes.fill(0, 0x400, 0x2400);
  const va = offset => 0x10000000 + offset + (offset < 0x2400 ? 0xc00 : 0x1c00);
  const put = (offset, hex) => Buffer.from(hex, "hex").copy(bytes, offset);
  const call = (offset, target) => {
    bytes[offset] = 0xe8; bytes.writeInt32LE(va(target) - va(offset + 5), offset + 1);
  };
  const callback = 0x800, registration = 0xa00;
  put(callback, "83ec08568b742410833e187422a10000000085c075126800000000e80000000083c404a3000000006800000000ffd0");
  bytes.writeUInt32LE(va(0x2900), callback + 14); bytes.writeUInt32LE(va(0x2900), callback + 36);
  bytes.writeUInt32LE(va(0x2600), callback + 23); bytes.writeUInt32LE(va(0x2800), callback + 41);
  call(callback + 27, 0xc00);
  put(callback + 47, "8b561433c0c1ea093946107627578d49008bc833ff034e04137e08897c240c750583f90b76078b4e0c03c83011403b461072de5f5e83c408c20400");
  bytes[callback + 54] = shift; bytes[callback + 82] = boundary;
  put(registration, "8b44240450e800000000a10000000083c40485c075126800000000e80000000083c404a3000000006800000000ffd033c0c20400");
  call(registration + 5, 0xc10); call(registration + 27, 0xc00);
  bytes.writeUInt32LE(va(0x2910), registration + 11); bytes.writeUInt32LE(va(0x2910), registration + 36);
  bytes.writeUInt32LE(va(0x2700), registration + 23); bytes.writeUInt32LE(va(callback), registration + 41);
  bytes[0xc00] = bytes[0xc10] = 0xc3;
  bytes.write("void ::TVPThrowExceptionMessage(const tjs_char *)\0", 0x2600);
  bytes.write("void ::TVPSetXP3ArchiveExtractionFilter(tTVPXP3ArchiveExtractionFilter)\0", 0x2700);
  bytes.write("Synthetic extraction record error\0", 0x2800);
  return bytes;
}

