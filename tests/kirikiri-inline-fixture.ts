import {tinyPE} from "./kirikiri-pe-fixture.js";

/** Synthetic inline reader and connected six-field record constructor. */
export function inlinePE(): Buffer {
  const bytes = tinyPE(); bytes.fill(0, 0x400, 0x2400);
  const va = (offset: number) => 0x10001000 + offset - 0x400;
  const at = 0x900;
  bytes.set([0x8d, 0x45, 0xd4], at - 53);
  bytes[at - 41] = 0xe8; bytes.writeInt32LE(va(0x1100) - va(at - 36), at - 40);
  Buffer.from("8d5dd4833b18740ab800400010e8000000008b15004000108955f08a15044000108855f4", "hex").copy(bytes, at - 36);
  Buffer.from("8b43148bd08bc8c1ea0880e2ff8855f08855f18bd0d1e9c1ea0780e1ff884df280e2ff8855f38bd0c1ea0580e2ff8855f48bcac745ec0400000033ffeb2f8bc733d203430413530883fa00750383f86476148b430403c72345ec8a5405f08b430c301438eb068b530c300c3a473b7b1072cc", "hex").copy(bytes, at);
  Buffer.from("c703180000008b550c8953048b551089530889730c894b108b4d08894b14c20c00", "hex").copy(bytes, 0x1100);
  return bytes;
}

/** Independent scalar oracle for this synthetic module's native contract. */
export function inlineCrypt(bytes: Buffer, seed: number): Buffer {
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= (seed >>> (i <= 100 || (i & 4) ? 5 : 8)) & 255;
  return bytes;
}

/** Synthetic TLG dispatch and dimension readers, with independent markers/keys. */
export function inlineTlgPE(): Buffer {
  const bytes = inlinePE(), va = (offset: number) => 0x10001000 + offset - 0x400;
  const call = (at: number, target: number) => {bytes[at] = 0xe8; bytes.writeInt32LE(va(target) - va(at + 5), at + 1);};
  const dataVA = (offset: number) => 0x10004000 + offset - 0x2400;
  bytes.write("ABCDEF\0raw\x1a\0", 0x2800, "binary"); bytes.write("UVWXYZ\0raw\x1a\0", 0x2820, "binary");
  Buffer.from("6a0b8d55c8526800000000e80000000083c40c85c0751b8b4d1851538b450c508bc68a5508528bd78b4dd4e800000000eb73", "hex").copy(bytes, 0x1300);
  bytes.writeUInt32LE(dataVA(0x2800), 0x1307);call(0x130b, 0x1800);call(0x132b, 0x1500);
  Buffer.from("6a0b8d4dc8516800000000e80000000083c40c85c075228b451850538b550c8bc6528bd7807d08000f95c183e101518b4dd4e800000000eb3a", "hex").copy(bytes, 0x1332);
  bytes.writeUInt32LE(dataVA(0x2820), 0x1339);call(0x133d, 0x1800);call(0x1364, 0x1600);
  for (const target of [0x1500, 0x1600]) Buffer.from("558bec81c480ffffff535657", "hex").copy(bytes, target);
  Buffer.from("8b4510e8000000008bd88b4510e8000000008945c48b4510e8000000008945bc81f3501300008175c489460000837dc0037440837dc004743a", "hex").copy(bytes, 0x1510);
  for (const offset of [0x1513, 0x151d, 0x1528]) call(offset, 0x1810);
  Buffer.from("8b4510e8000000008945a08b4510e80000000089459c8175a05013000081759c894600008b4510e8000000008945988b4d9c8b55a08b45acff55a8", "hex").copy(bytes, 0x1710);
  for (const offset of [0x1713, 0x171e, 0x1737]) call(offset, 0x1810);
  bytes[0x1800] = 0xc3; bytes[0x1810] = 0xc3;
  return bytes;
}

export function tlg5Pixel(native = false): Buffer {
  const head = Buffer.alloc(13); head[0] = 3;
  head.writeUInt32LE(1 ^ (native ? 0x1350 : 0), 1); head.writeUInt32LE(1 ^ (native ? 0x4689 : 0), 5); head.writeUInt32LE(1, 9);
  const planes = Buffer.from([1, 1, 0, 0, 0, 3, 1, 1, 0, 0, 0, 5, 1, 1, 0, 0, 0, 7]);
  return Buffer.concat([Buffer.from((native ? "ABCDEF" : "TLG5.0") + "\0raw\x1a", "binary"), head, Buffer.alloc(4), planes]);
}
