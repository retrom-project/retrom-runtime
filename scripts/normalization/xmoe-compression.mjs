import {requireXmoe, xmoeLimits, xmoeRange} from "./xmoe-common.mjs";

// LSB-first CHuffman table and escape runs, followed by a u32 output length.
// The table consumes floor(bitCount / 8) + 1 bytes, including an extra padding
// byte when its last code ends on a byte boundary.
export function unpackXmoeIndex(bytes, expected, signal) {
  signal?.throwIfAborted(); let bit = 0;
  const read = count => {
    requireXmoe(count >= 0 && count <= 16 && bit + count <= bytes.length * 8); let value = 0;
    for (let i = 0; i < count; i++, bit++) {value |= ((bytes[bit >>> 3] >>> (bit & 7)) & 1) << i;}
    return value;
  };
  const count = read(8), escapeLength = read(8), root = {};
  function add(symbol, length, code) {
    requireXmoe(length > 0 && length <= 9); let node = root;
    for (let i = 0; i < length; i++) {requireXmoe(node.symbol === undefined); const key = code >>> i & 1; node[key] ??= {}; node = node[key];}
    requireXmoe(node.symbol === undefined && node[0] === undefined && node[1] === undefined); node.symbol = symbol;
  }
  add(256, escapeLength, read(escapeLength)); const symbols = new Set([256]);
  for (let i = 0; i < count; i++) {
    const symbol = read(8), length = read(8); requireXmoe(!symbols.has(symbol)); symbols.add(symbol); add(symbol, length, read(length));
  }
  const tableBytes = (bit >>> 3) + 1;
  const length = xmoeRange(bytes, tableBytes, 4).readUInt32LE();
  requireXmoe(length > 0 && length <= xmoeLimits.index, "RUNTIME_XMOE_LIMIT"); requireXmoe(length === expected);
  bit = (tableBytes + 4) * 8; const result = Buffer.alloc(length); let at = 0;
  while (at < length) {
    if ((at & 4095) === 0) {signal?.throwIfAborted();}
    let node = root;
    while (node.symbol === undefined) {node = node[read(1)]; requireXmoe(node);}
    if (node.symbol !== 256) {result[at++] = node.symbol; continue;}
    const run = read(4); requireXmoe(run > 0 && run <= length - at);
    for (let i = 0; i < run; i++) {result[at++] = read(8);}
  }
  requireXmoe(bytes.length * 8 - bit < 8);
  while (bit < bytes.length * 8) {requireXmoe(read(1) === 0);}
  return result;
}
export function unpackXmoeLz4(bytes, length, signal) {
  signal?.throwIfAborted(); requireXmoe(length > 0 && length <= xmoeLimits.file, "RUNTIME_XMOE_LIMIT");
  const result = Buffer.alloc(length); let at = 0, out = 0;
  const extension = size => {
    if (size !== 15) {return size;}
    for (;;) {requireXmoe(at < bytes.length); const next = bytes[at++]; size += next; requireXmoe(size <= length); if (next !== 255) {return size;}}
  };
  while (out < length) {
    signal?.throwIfAborted(); requireXmoe(at < bytes.length); const token = bytes[at++], literals = extension(token >>> 4);
    requireXmoe(literals <= length - out); xmoeRange(bytes, at, literals).copy(result, out); at += literals; out += literals;
    if (out === length) {break;}
    const back = xmoeRange(bytes, at, 2).readUInt16LE(); at += 2; const count = extension(token & 15) + 4;
    requireXmoe(back > 0 && back <= out && count <= length - out);
    for (let i = 0; i < count; i++) {if ((i & 4095) === 0) {signal?.throwIfAborted();} result[out] = result[out - back]; out++;}
  }
  requireXmoe(at === bytes.length); return result;
}
