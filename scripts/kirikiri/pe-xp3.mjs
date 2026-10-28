import {openContent} from "../runtime-host-content.mjs";
import {magic, readExact, requireFormat, safeName} from "./bytes.mjs";
import {readXp3} from "./xp3.mjs";

/** Find a file-backed XP3 overlay after valid PE sections, within one logical
 * source slice. PE bytes are inspected as data and are never executed. */
export async function peXp3(locator, signal) {
  if (locator.sizeBytes < 64) {return null;}
  const handle = await openContent(locator);
  try {
    const dos = await readExact(handle, 0, 64);
    if (dos.toString("ascii", 0, 2) !== "MZ") {return null;}
    const at = dos.readUInt32LE(60);
    if (at < 64 || at > 1024 * 1024 || at + 24 > locator.sizeBytes) {return null;}
    const pe = await readExact(handle, at, 24), count = pe.readUInt16LE(6), optional = pe.readUInt16LE(20);
    if (pe.readUInt32LE() !== 0x4550 || !count || count > 96 || optional < 64 || at + 24 + optional + count * 40 > locator.sizeBytes) {return null;}
    const headers = await readExact(handle, at + 24, optional + count * 40), type = headers.readUInt16LE();
    if (type !== 0x10b && type !== 0x20b) {return null;}
    let end = at + 24 + headers.length;
    const sections = [];
    for (let i = 0; i < count; i++) {
      const pos = optional + i * 40, start = headers.readUInt32LE(pos + 20), size = headers.readUInt32LE(pos + 16);
      if (!size) {continue;}
      if (start < at + 24 + headers.length || size > locator.sizeBytes - start ||
          sections.some(section => start < section.end && section.start < start + size)) {return null;}
      sections.push({start, end: start + size}); end = Math.max(end, start + size);
    }
    if (end + 19 > locator.sizeBytes) {return null;}
    const tail = await readExact(handle, end, Math.min(16 * 1024 * 1024, locator.sizeBytes - end));
    let cursor = 0, attempts = 0; const matches = [];
    while (cursor < tail.length) {
      signal?.throwIfAborted();
      const found = tail.indexOf(magic, cursor);
      if (found < 0) {break;}
      requireFormat(++attempts <= 32, "ARCHIVE_LIMIT"); cursor = found + magic.length;
      const offset = end + found, slice = {...locator, offset: locator.offset + offset, sizeBytes: locator.sizeBytes - offset};
      let archive;
      try {archive = await readXp3(slice, {signal, includePlainEntries: true});}
      catch (error) {
        if (signal?.aborted || !/^RUNTIME_KIRIKIRI_ARCHIVE_/u.test(error.message ?? "")) {throw error;}
        continue;
      }
      if (!archive?.entries?.length || archive.format || archive.unsupportedFormat) {continue;}
      requireFormat(archive.entries.every(entry => safeName(entry.name)), "ARCHIVE_UNSUPPORTED");
      matches.push({...archive, sourceLocator: locator, omitted: [], entries: archive.entries.map(entry => ({...entry, h: entry.adler}))});
    }
    requireFormat(matches.length <= 1, "ARCHIVE_UNSUPPORTED");
    return matches[0] ?? null;
  } finally {await handle.close();}
}
