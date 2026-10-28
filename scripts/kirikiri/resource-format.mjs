import {crc32} from "node:zlib";
import {isPeModule} from "./cxdec-pe.mjs";
import {requireFormat} from "./bytes.mjs";

function png(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {return false;}
  let first = true, ended = false;
  for (let at = 8; at < bytes.length;) {
    if (at + 12 > bytes.length) {return false;}
    const size = bytes.readUInt32BE(at), end = at + 12 + size;
    if (end > bytes.length || crc32(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) {return false;}
    const tag = bytes.toString("ascii", at + 4, at + 8);
    if (first && (tag !== "IHDR" || size !== 13 || !bytes.readUInt32BE(at + 8) || !bytes.readUInt32BE(at + 12))) {return false;}
    first = false;
    if (tag === "IEND") {ended = size === 0 && end === bytes.length; break;}
    at = end;
  }
  return ended;
}
function ogg(bytes) {
  let pages = 0;
  for (let at = 0; at < bytes.length;) {
    if (at + 27 > bytes.length || bytes.toString("ascii", at, at + 4) !== "OggS" || bytes[at + 4] !== 0) {return false;}
    const count = bytes[at + 26], header = at + 27 + count;
    if (header > bytes.length) {return false;}
    let size = 0;
    for (let i = at + 27; i < header; i++) {size += bytes[i];}
    const end = header + size;
    if (end > bytes.length) {return false;}
    let crc = 0;
    for (let i = at; i < end; i++) {
      crc ^= (i >= at + 22 && i < at + 26 ? 0 : bytes[i]) << 24;
      for (let bit = 0; bit < 8; bit++) {crc = (crc << 1 ^ (crc < 0 ? 0x04c11db7 : 0)) | 0;}
    }
    if (crc >>> 0 !== bytes.readUInt32LE(at + 22)) {return false;}
    pages++; at = end;
  }
  return pages > 0;
}
function text(bytes) {
  try {
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
    if (utf16 && bytes.length % 2) {return false;}
    const value = new TextDecoder(utf16 ? "utf-16le" : "utf-8", {fatal: true}).decode(bytes);
    return value.length > 0 && !/\p{Cc}/u.test(value.replace(/[\t\r\n]/gu, ""));
  } catch {return false;}
}
function recognized(bytes) {return png(bytes) || ogg(bytes) || isPeModule(bytes) || text(bytes);}

/** A seed-only index provides no source checksum. Admit only an unambiguous,
 * complete supported representation under an independently authenticated filter;
 * conversion audits this as corrected metadata, never as a source integrity pass. */
export function resolveSeedOnly(raw, filter, seed) {
  requireFormat(raw.length <= 32 * 1024 * 1024, "ARCHIVE_LIMIT");
  const decoded = Buffer.from(raw); filter.apply(decoded, seed, 0);
  const clear = recognized(raw), transformed = recognized(decoded);
  requireFormat(clear || transformed, "CHECKSUM_MISMATCH");
  requireFormat(!(clear && transformed) || raw.equals(decoded), "FILTER_AMBIGUOUS");
  return clear ? raw : decoded;
}
