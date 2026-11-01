import {tinyPE} from "./kirikiri-pe-fixture.js";

/** A synthetic PE with an independently parameterized archive-filter record. */
export function configuredPE(): Buffer {
  const bytes = tinyPE();
  bytes.fill(0, 0x400, 0x2400);
  const textVA = (offset: number) => 0x10001000 + offset - 0x400;
  const dataVA = (offset: number) => 0x10004000 + offset - 0x2400;
  const put32 = (at: number, value: number) => bytes.writeUInt32LE(value >>> 0, at);
  const call = (at: number, target: number) => {bytes[at] = 0xe8; bytes.writeInt32LE(textVA(target) - textVA(at + 5), at + 1);};
  const push = (at: number, value: number) => {bytes[at] = 0x68; put32(at + 1, value);};

  bytes.write("PARAMS\0", 0x2800, "ascii");
  bytes.write("TABLE\0", 0x2810, "ascii");
  bytes.write("void ::TVPSetXP3ArchiveExtractionFilter(tTVPXP3ArchiveExtractionFilter)\0", 0x2820, "ascii");
  const params = Buffer.from([7, 6, 5, 4, 3, 2, 1, 0, 5, 4, 3, 2, 1, 0, 2, 1, 0, 0, 31, 0, 32, 0]);
  const table = Buffer.from(Array.from({length: 4096}, (_, i) => (i * 29 + 11) & 255));
  let at = 0x3000;
  for (const part of [Buffer.from("--data--PARAMS\0"), Buffer.from([22, 0]), params,
    Buffer.from("TABLE\0"), Buffer.from([0, 16]), table, Buffer.from([0])]) {part.copy(bytes, at); at += part.length;}

  // Parser loads the record sequence; both tag lookups call this same parser.
  bytes[0x600] = 0xbf; put32(0x601, dataVA(0x3008)); bytes[0x605] = 0xc3;
  push(0x800, dataVA(0x2800)); call(0x805, 0x600);
  push(0x80a, dataVA(0x2810)); call(0x80f, 0x600);
  push(0x814, dataVA(0x2820)); call(0x819, 0xb00);
  push(0x81e, textVA(0xa00)); bytes.set([0xff, 0xd0, 0xc3], 0x823);
  bytes.set([0x83, 0x3b, 0x18, 0x72, 0x03, 0xff, 0x73, 0x14, 0xc2, 4, 0], 0xa00);
  bytes[0xb00] = 0xc3;
  bytes.set([0x69, 0xc9, 0x6d, 0x4e, 0xc6, 0x41, 0x81, 0xc1, 0x39, 0x30, 0, 0, 0xc3], 0xc00);
  return bytes;
}
