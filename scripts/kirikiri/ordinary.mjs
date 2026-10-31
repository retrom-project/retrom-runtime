import {readXp3} from "./xp3.mjs";
import {adler32, resourceBytes, safeName, requireFormat} from "./bytes.mjs";

export async function ordinaryArchive(locator, signal) {
  let archive;
  try {archive = await readXp3(locator, {signal, includePlainEntries: true, canonicalizeInfoSize: true});}
  catch (error) {
    if (signal?.aborted || !/^RUNTIME_KIRIKIRI_ARCHIVE_/u.test(error.message ?? "")) {throw error;}
    return null;
  }
  if (!archive || archive.format || !archive.entries?.length) {return null;}
  const seedOnly = archive.entries.length > 1 && archive.entries.every(entry => entry.flags === 0 && entry.adler === 0);
  return {...archive, omitted: [], entries: archive.entries.map(entry => ({...entry, h: entry.adler, seedOnly}))};
}

// Protection flags do not identify an algorithm. A fixed byte XOR is accepted
// only after three complete, distinct checksums independently authenticate it.
export async function fixedXorArchive(locator, signal, providedArchive) {
  const archive = providedArchive ?? await ordinaryArchive(locator, signal);
  if (!archive || archive.format || !archive.entries?.length) {return null;}
  const seeds = new Set(), probes = [], short = [];
  for (const entry of archive.entries) {
    if (entry.flags !== 0x80000000 || entry.size > 4 * 1024 * 1024 || seeds.has(entry.adler) || entry.size < 32 && short.length === 8) {continue;}
    const chunks = [];
    for await (const bytes of resourceBytes(locator, entry, signal)) {chunks.push(bytes);}
    (entry.size < 32 ? short : probes).push({bytes: Buffer.concat(chunks), adler: entry.adler}); seeds.add(entry.adler);
    if (probes.length === 8) {break;}
  }
  const clear = [...probes, ...short];
  if (clear.length && clear.every(probe => adler32(probe.bytes) === probe.adler)) {return {plaintext: true};}
  if (probes.length < 3) {return null;}
  let key = null;
  for (let candidate = 1; candidate < 256; candidate++) {
    signal?.throwIfAborted();
    if (probes.every(probe => {
      const decoded = Buffer.from(probe.bytes);
      for (let i = 0; i < decoded.length; i++) {decoded[i] ^= candidate;}
      return adler32(decoded) === probe.adler;
    })) {
      if (key !== null) {return null;}
      key = candidate;
    }
  }
  if (key === null) {return null;}
  requireFormat(archive.entries.every(entry => safeName(entry.name)), "ARCHIVE_UNSUPPORTED");
  return {archive: {...archive, format: "xp3-fixed-xor", omitted: [], entries: archive.entries.map(entry => ({...entry, h: entry.adler}))},
    filter: {kind: "fixed-xor", verified: true, inputProfile: {profile: {key}}, apply(bytes, _seed, _offset, entry) {
      if (entry.flags === 0x80000000) {for (let i = 0; i < bytes.length; i++) {bytes[i] ^= key;}}
      return bytes;
    }}};
}
