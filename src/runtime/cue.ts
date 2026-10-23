import {configurationFailure, logicalPath} from "./validation.js";

type Reference = {logicalKey: string; relativeTo: string; relativePath: string};

/** Decode once for both discovery and loading. Legacy names require unambiguous file evidence. */
export function cueContentReferences(bytes: Uint8Array, entry: string, available: readonly string[]): Reference[] {
  if (bytes.length > 1024 * 1024 || !logicalPath(entry)) {configurationFailure("RUNTIME_CUE_INVALID");}
  const bom = bomEncoding(bytes);
  const unicode = decoded(bytes, bom ?? "utf-8");
  if (unicode !== undefined || bom) {
    const references = unicode === undefined ? undefined : parsed(unicode, entry);
    if (!references) {configurationFailure("RUNTIME_CUE_INVALID");}
    return references;
  }
  const candidates: Reference[][] = [];
  for (const encoding of ["shift_jis", "gb18030"]) {
    const text = decoded(bytes, encoding), references = text === undefined ? undefined : parsed(text, entry);
    if (references && !candidates.some(candidate => JSON.stringify(candidate) === JSON.stringify(references))) {candidates.push(references);}
  }
  if (!candidates.length) {configurationFailure("RUNTIME_CUE_INVALID");}
  if (candidates.length === 1) {return candidates[0];}
  const complete = candidates.filter(references => references.every(reference =>
    available.filter(key => key.toLowerCase() === reference.logicalKey.toLowerCase()).length === 1));
  if (complete.length === 1) {return complete[0];}
  configurationFailure("RUNTIME_CUE_ENCODING_REQUIRED", {entryFile: entry});
}

function bomEncoding(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {return "utf-16le";}
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {return "utf-16be";}
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {return "utf-8";}
  return undefined;
}

function decoded(bytes: Uint8Array, encoding: string): string | undefined {
  try {return new TextDecoder(encoding, {fatal: true}).decode(bytes);} catch {return undefined;}
}

function parsed(text: string, entry: string): Reference[] | undefined {
  const root = entry.slice(0, entry.lastIndexOf("/") + 1), references: Reference[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!/^\s*FILE\s/iu.test(line)) {continue;}
    const match = /^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+\S+\s*$/iu.exec(line), name = match?.[1] ?? match?.[2];
    if (!logicalPath(name) || !logicalPath(root + name)) {return undefined;}
    references.push({logicalKey: root + name, relativeTo: entry, relativePath: name});
  }
  return references.length ? references : undefined;
}
