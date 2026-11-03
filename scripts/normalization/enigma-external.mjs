import {enigmaDepack, enigmaLimits, enigmaRange, readEnigma, requireEnigma} from "./enigma-codec.mjs";

const matches = (b, at, pattern) => at >= 0 && at + pattern.length <= b.length && pattern.every((v, i) => v === null || b[at + i] === v);
const multiply = (a, b) => (((a || 65536) * (b || 65536)) % 65537) & 65535;
function inverse(value) {
  let a = value || 65536, b = 65537, x = 1, y = 0;
  while (b) {const q = Math.floor(a / b); [a, b] = [b, a - q * b]; [x, y] = [y, x - q * y];}
  return ((x % 65537 + 65537) % 65537) & 65535;
}
function ideaKeys(key) {
  const encode = new Uint16Array(52), decode = new Uint16Array(52);
  for (let i = 0; i < 8; i++) {encode[i] = key.readUInt16BE(2 * i);}
  for (let i = 8; i < 52; i++) {
    const n = i & 7;
    encode[i] = (encode[i - (n === 7 ? 15 : 7)] << 9) | (encode[i - (n >= 6 ? 14 : 6)] >>> 7);
  }
  for (let round = 0; round < 9; round++) {
    const at = 6 * round, source = 48 - at;
    decode[at] = inverse(encode[source]); decode[at + 3] = inverse(encode[source + 3]);
    decode[at + 1] = -encode[source + (round === 0 || round === 8 ? 1 : 2)];
    decode[at + 2] = -encode[source + (round === 0 || round === 8 ? 2 : 1)];
    if (round < 8) {decode[at + 4] = encode[source - 2]; decode[at + 5] = encode[source - 1];}
  }
  return {encode, decode};
}
function ideaBlock(bytes, keys) {
  let x1 = bytes.readUInt16BE(), x2 = bytes.readUInt16BE(2), x3 = bytes.readUInt16BE(4), x4 = bytes.readUInt16BE(6);
  for (let i = 0; i < 48; i += 6) {
    x1 = multiply(x1, keys[i]); x2 = (x2 + keys[i + 1]) & 65535;
    x3 = (x3 + keys[i + 2]) & 65535; x4 = multiply(x4, keys[i + 3]);
    let a = multiply(x1 ^ x3, keys[i + 4]);
    const b = multiply(((x2 ^ x4) + a) & 65535, keys[i + 5]); a = (a + b) & 65535;
    [x1, x2, x3, x4] = [x1 ^ b, x3 ^ b, x2 ^ a, x4 ^ a];
  }
  const out = Buffer.alloc(8);
  out.writeUInt16BE(multiply(x1, keys[48])); out.writeUInt16BE((x3 + keys[49]) & 65535, 2);
  out.writeUInt16BE((x2 + keys[50]) & 65535, 4); out.writeUInt16BE(multiply(x4, keys[51]), 6);
  return out;
}
// Native IDEA-128 CBC uses E_K(0) as its IV and an encrypted previous block
// for the final partial block. The configuration stores no executable code.
export function enigmaIdeaDecrypt(bytes, key, signal) {
  signal?.throwIfAborted(); requireEnigma(key.length === 16 && bytes.length <= enigmaLimits.metadata);
  const keys = ideaKeys(key), out = Buffer.alloc(bytes.length); let previous = ideaBlock(Buffer.alloc(8), keys.encode);
  let at = 0;
  for (; at + 8 <= bytes.length; at += 8) {
    if (!(at & 4095)) {signal?.throwIfAborted();}
    const plain = ideaBlock(bytes.subarray(at, at + 8), keys.decode);
    for (let i = 0; i < 8; i++) {out[at + i] = plain[i] ^ previous[i];}
    previous = bytes.subarray(at, at + 8);
  }
  if (at < bytes.length) {
    const tail = ideaBlock(previous, keys.encode);
    for (let i = 0; at + i < bytes.length; i++) {out[at + i] = bytes[at + i] ^ tail[i];}
  }
  return out;
}

/** Parse the native dynamic configuration grammar, retaining only mount masks. */
export function enigmaExternalMasks(bytes, signal) {
  signal?.throwIfAborted(); requireEnigma(bytes.length <= enigmaLimits.metadata, "LIMIT");
  let at = 0, operations = 0;
  const take = n => {const b = enigmaRange(bytes, at, n); at += n; return b;};
  const word = () => take(4).readUInt32LE();
  const count = () => {const n = word(); requireEnigma(n <= enigmaLimits.entries && (operations += n) <= enigmaLimits.entries, "LIMIT"); return n;};
  const each = action => {for (let n = count(); n > 0; n--) {signal?.throwIfAborted(); action();}};
  const wide = () => {const n = word(); requireEnigma(n <= enigmaLimits.metadata / 2, "LIMIT"); return take(n * 2);};
  const variant = () => {const n = take(2).readUInt16LE(); take(n);};
  each(() => {const n = take(1)[0]; take(8); take(n);});
  for (let i = 0; i < 3; i++) {variant();}
  take(take(1)[0]); // serialized locale string, replaced by a native locale at execution
  for (let i = 0; i < 6; i++) {variant();}
  for (const width of [4, 16, 16]) {each(() => take(width));}
  each(() => {take(2); wide(); take(1); wide(); take(1); wide();});
  each(() => take(256));
  each(() => {take(1); wide(); wide();});
  each(() => take(512)); each(() => take(544));
  each(() => {take(20); take(word());});
  const masks = [];
  each(() => {
    const raw = wide(); let value;
    try {value = new TextDecoder("utf-16le", {fatal: true, ignoreBOM: true}).decode(raw);} catch {requireEnigma(false);}
    requireEnigma(value.length > 0 && [...value].every(character => character.charCodeAt(0) >= 32), "UNSUPPORTED"); masks.push(value);
  });
  requireEnigma(at === bytes.length, "UNSUPPORTED");
  return masks;
}

function loaderParameters(bootstrap) {
  const found = [];
  for (let at = 0; at + 108 < bootstrap.length; at++) {
    if (!matches(bootstrap, at, [0x50, 0x50, 0x68, null, null, null, null, 0x68, null, null, null, null,
      1, 0x2c, 0x24, 0x68, null, null, null, null, 0xe8, 5, 0, 0, 0, 0xe9, 0x28, 0, 0, 0]) ||
        !matches(bootstrap, at + 30, [0x55, 0x8b, 0xec, 0x8b, 0x85, 8, 0, 0, 0, 0x8b, 0x95, 12, 0, 0, 0,
          0x8b, 0x8d, 16, 0, 0, 0, 0xc1, 0xe9, 2, 0x31, 2, 0x83, 0xc2, 4, 0x49, 0x0f, 0x85, 0xf4, 255, 255, 255, 0x5d, 0xc2, 12, 0]) ||
        !matches(bootstrap, at + 70, [0x8b, 0x8c, 0x24, 4, 0, 0, 0, 0x68, null, null, null, null,
          0x68, null, null, null, null, 1, 0x2c, 0x24, 0x51, 0xe8, 5, 0, 0, 0, 0xe9])) {continue;}
    const length = bootstrap.readUInt32LE(at + 3), rva = bootstrap.readUInt32LE(at + 8);
    requireEnigma(length === bootstrap.readUInt32LE(at + 78) && rva === bootstrap.readUInt32LE(at + 83), "UNSUPPORTED");
    found.push({length, rva, key: bootstrap.readUInt32LE(at + 16)});
  }
  requireEnigma(found.length === 1, "UNSUPPORTED");
  // These connected BCJ write instructions establish the post-depack transform.
  requireEnigma(bootstrap.includes(Buffer.from("294c390183c10583e804", "hex")) &&
    bootstrap.includes(Buffer.from("2954390283c10683ea0483e805", "hex")), "UNSUPPORTED");
  return found[0];
}
function unfilterLoader(bytes) {
  let delta = 0;
  for (let at = 0; at + 6 <= bytes.length;) {
    if (bytes[at] === 0xe8 || bytes[at] === 0xe9) {
      bytes.writeUInt32LE((bytes.readUInt32LE(at + 1) - at) >>> 0, at + 1); at += 5;
    } else if (bytes[at] === 255 && bytes[at + 1] === 0x25) {
      bytes.writeUInt32LE((bytes.readUInt32LE(at + 2) - delta) >>> 0, at + 2); at += 6; delta -= 4;
    } else {at++;}
  }
  return bytes;
}

/** Recover explicitly configured external mounts using the same static loader. */
export async function enigmaExternalConfig(handle, size, configuration, signal) {
  signal?.throwIfAborted();
  const {bootstrap, fromRva, masterConfig, loaderVirtualSize} = configuration;
  const fixedSize = 0xdc + 0x88 + 0xf5d0;
  requireEnigma(masterConfig.length >= fixedSize);
  const fields = masterConfig.subarray(masterConfig.length - 0xf5d0);
  const secondary = masterConfig.subarray(masterConfig.length - 0xf5d0 - 0x88, masterConfig.length - 0xf5d0);
  const field = n => n - 0x328;
  const packed = secondary.readUInt32LE(0x310 - 0x2a0), expanded = secondary.readUInt32LE(0x314 - 0x2a0);
  const context = fields.subarray(field(0xb081) + 512, field(0xb081) + 1024);
  const result = {masks: [], headerState: Buffer.from(context.subarray(0, 256)),
    payloadState: Buffer.from(context.subarray(256)), encryptedHeader: Boolean(fields[field(0xb07d)])};
  if (!packed && !expanded) {return result;}
  requireEnigma(packed > 0 && packed <= enigmaLimits.metadata && expanded > 0 && expanded <= enigmaLimits.metadata, "LIMIT");
  const loader = loaderParameters(bootstrap), sourceAt = fromRva(loader.rva, loader.length);
  requireEnigma(sourceAt >= 0 && loader.length > 0 && loader.length <= enigmaLimits.metadata, "UNSUPPORTED");
  const source = await readEnigma(handle, size, sourceAt, loader.length, signal);
  for (let at = 0; at + 4 <= source.length; at += 4) {source.writeUInt32LE((source.readUInt32LE(at) ^ loader.key) >>> 0, at);}
  const image = unfilterLoader(enigmaDepack(source, loaderVirtualSize, signal, {dwordPadding: true}));
  requireEnigma(image.toString("ascii", 0, 2) === "MZ", "UNSUPPORTED");
  const nt = enigmaRange(image, 60, 4).readUInt32LE();
  requireEnigma(enigmaRange(image, nt, 4).readUInt32LE() === 0x4550 &&
    enigmaRange(image, nt + 80, 4).readUInt32LE() === loaderVirtualSize, "UNSUPPORTED");
  const dynamicRva = secondary.readUInt32LE(0x30c - 0x2a0);
  const decrypted = enigmaIdeaDecrypt(enigmaRange(image, dynamicRva, packed), enigmaRange(fields, field(0x5b8), 16), signal);
  const dynamic = enigmaDepack(decrypted, expanded, signal);
  return {...result, masks: enigmaExternalMasks(dynamic, signal),
    evidence: {loaderRva: loader.rva, loaderBytes: image.length, dynamicRva, configurationBytes: dynamic.length}};
}
