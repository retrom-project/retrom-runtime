// Synthetic format evidence for tests only. No original PE or game bytes.
export function tinyPE(xorConstant = 0x12345678, zeroFallback = 0x55): Buffer {
  if (!Number.isInteger(xorConstant) || xorConstant < 0 || xorConstant > 0xffffffff ||
      !Number.isInteger(zeroFallback) || zeroFallback < 1 || zeroFallback > 255) throw new Error("invalid synthetic Tiny parameters");
  const b = Buffer.alloc(0x6000);
  b.write("MZ"); b.writeUInt32LE(0x80, 0x3c); b.write("PE\0\0", 0x80, "binary");
  b.writeUInt16LE(0x14c, 0x84); b.writeUInt16LE(2, 0x86); b.writeUInt16LE(0xe0, 0x94);
  b.writeUInt16LE(0x10b, 0x98); b.writeUInt32LE(0x10000000, 0xb4); b.writeUInt32LE(0x8000, 0xd0);
  const section = (at: number, name: string, rva: number, size: number, raw: number, flags: number) => {
    b.write(name, at); b.writeUInt32LE(size, at + 8); b.writeUInt32LE(rva, at + 12);
    b.writeUInt32LE(size, at + 16); b.writeUInt32LE(raw, at + 20); b.writeUInt32LE(flags, at + 36);
  };
  section(0x178, ".text", 0x1000, 0x2000, 0x400, 0x60000020);
  section(0x1a0, ".rdata", 0x4000, 0x3000, 0x2400, 0x40000040);
  const constant = Buffer.alloc(4); constant.writeUInt32LE(xorConstant);
  Buffer.from([0x81, 0xf1, ...constant, 0x8b, 0xd1, 0xc1, 0xea, 24,
    0x8b, 0xc1, 0xc1, 0xe8, 16, 0x32, 0xd0, 0x8b, 0xc1, 0xc1, 0xe8, 8,
    0x32, 0xd0, 0x32, 0xd1, 0x88, 0x56, 4, 0x75, 4, 0xc6, 0x46, 4, zeroFallback, 0xc3]).copy(b, 0x1500);
  return b;
}
