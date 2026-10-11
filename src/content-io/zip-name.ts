const cp437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/** ZIP's explicit Unicode metadata wins; unmarked Chinese archives retain their GB18030 names. */
export function decodeZIPName(bytes: Uint8Array, flags: number, extra: Uint8Array = new Uint8Array()): string {
  if (flags & 0x800) {return text(bytes, "utf-8");}
  const unicode = unicodePath(bytes, extra);
  if (unicode !== null) {return unicode;}
  for (const encoding of ["utf-8", "gb18030"]) {
    try {return text(bytes, encoding);} catch { /* Try the next legacy ZIP encoding. */ }
  }
  return Array.from(bytes, byte => byte < 128 ? String.fromCharCode(byte) : cp437[byte - 128]).join("");
}

export function zipNameCRC32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);}
  }
  return (value ^ 0xffffffff) >>> 0;
}

function text(bytes: Uint8Array, encoding: string) {
  try {return new TextDecoder(encoding, {fatal: true, ignoreBOM: true}).decode(bytes);}
  catch {throw new Error("ZIP_FILENAME_INVALID");}
}

function unicodePath(name: Uint8Array, extra: Uint8Array): string | null {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let at = 0; at < extra.length;) {
    if (at + 4 > extra.length) {throw new Error("ZIP_FILENAME_INVALID");}
    const tag = view.getUint16(at, true), length = view.getUint16(at + 2, true), start = at + 4;
    if (start + length > extra.length) {throw new Error("ZIP_FILENAME_INVALID");}
    if (tag === 0x7075 && length >= 5 && extra[start] === 1 && view.getUint32(start + 1, true) === zipNameCRC32(name)) {
      return text(extra.subarray(start + 5, start + length), "utf-8");
    }
    at = start + length;
  }
  return null;
}
