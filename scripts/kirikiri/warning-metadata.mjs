import {requireFormat, normalizeName, safeName, resourceBytes} from "./bytes.mjs";

// Protector warning metadata has an index marker and an independently readable
// raw notice. Neither a similar filename nor a protection bit is sufficient.
export function shortWarningShape(entry) {
  return entry.flags === 0 && entry.size <= 4096 && entry.readable >= 32 && entry.readable < entry.size &&
    (entry.packed === entry.size || entry.packed === entry.readable) && entry.segments.length === 1 && entry.segments[0].mode === 0;
}
export async function validateWarningMetadata(locator, entries, signal) {
  for (const entry of entries) {
    if (entry.readable === entry.size && entry.segments.reduce((sum, segment) => sum + segment.packed, 0) === entry.packed) {continue;}
    const name = normalizeName(entry.name);
    requireFormat(shortWarningShape(entry) && safeName(entry.name) && safeName(name) && name.startsWith("$$$ this is a protected archive. $$$") && name.endsWith(".txt"));
    const chunks = []; for await (const bytes of resourceBytes(locator, entry, signal)) {chunks.push(bytes);}
    const body = Buffer.concat(chunks); let text;
    try {text = new TextDecoder("shift-jis", {fatal: true}).decode(body);} catch {requireFormat(false);}
    requireFormat(body.length === entry.readable && text.startsWith("Warning: Extracting this archive") &&
      [...text].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127 || "\t\r\n".includes(c)));
    entry.warningMetadata = true;
  }
}
