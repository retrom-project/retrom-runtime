import {zipSync} from "fflate";

/** Construct legacy file names in both ZIP headers without altering payloads. */
export function legacyZip(entries: Array<{name: Uint8Array; data: Uint8Array}>, utf8 = false) {
  const files = Object.fromEntries(entries.map((entry, index) => [String(index).padStart(entry.name.length, "x"), entry.data]));
  const bytes = zipSync(files, {level: 0});
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = view.getUint32(bytes.length - 6, true);
  for (const entry of entries) {
    const local = view.getUint32(offset + 42, true);
    bytes.set(entry.name, offset + 46); bytes.set(entry.name, local + 30);
    view.setUint16(offset + 8, utf8 ? 0x800 : 0, true);
    view.setUint16(local + 6, utf8 ? 0x800 : 0, true);
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return bytes;
}

export const gbkProgramName = Uint8Array.from([
  0xbd, 0xf0, 0xd3, 0xb9, 0xc8, 0xba, 0xcf, 0xc0, 0xb4, 0xab,
  ...new TextEncoder().encode("/PLAY.BAT"),
]);
