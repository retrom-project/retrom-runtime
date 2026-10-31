import {openContent} from "../runtime-host-content.mjs";
import {readExact} from "./bytes.mjs";

const maximumModule = 64 * 1024 * 1024;

/** Large installers commonly append payloads to a small PE image. Inspect the
 * complete bounded image without materializing or claiming its opaque overlay.
 * The caller still authenticates and retains the whole immutable source. */
export async function nativeModule(locator, signal) {
  const handle = await openContent(locator);
  try {
    signal?.throwIfAborted();
    if (locator.sizeBytes <= maximumModule) {return await readExact(handle, 0, locator.sizeBytes);}
    const dos = await readExact(handle, 0, 64), at = dos.readUInt32LE(60);
    if (dos.toString("ascii", 0, 2) !== "MZ" || at < 64 || at > 1024 * 1024 || at + 24 > locator.sizeBytes) {return null;}
    const pe = await readExact(handle, at, 24), count = pe.readUInt16LE(6), optional = pe.readUInt16LE(20);
    if (pe.readUInt32LE() !== 0x4550 || !count || count > 96 || optional < 64 || at + 24 + optional + count * 40 > locator.sizeBytes) {return null;}
    const headers = await readExact(handle, at + 24, optional + count * 40);
    if (headers.readUInt16LE() !== 0x10b) {return null;}
    let end = at + 24 + headers.length;
    for (let i = 0; i < count; i++) {
      const pos = optional + i * 40, start = headers.readUInt32LE(pos + 20), size = headers.readUInt32LE(pos + 16);
      if (size > locator.sizeBytes - start) {return null;}
      if (size) {end = Math.max(end, start + size);}
    }
    if (end > maximumModule) {return null;}
    return await readExact(handle, 0, end);
  } finally {await handle.close();}
}
