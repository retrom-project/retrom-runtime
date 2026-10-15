import {open} from "node:fs/promises";
import {constants} from "node:fs";
import {arcadeDiskRequirements, parseCHDHeader} from "../dist/runtime/index.js";
import {requireLocator, safePath} from "./runtime-archive-input.mjs";

export async function mameMediaEvidence(input, coreId) {
  if (coreId !== "mame_arcade") {return {};}
  const chdHeaders = {};
  for (const file of input.files.filter(file => /\.chd$/iu.test(file.logicalKey))) {
    const handle = await open(requireLocator(input, file), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat(), bytes = Buffer.alloc(124);
      if (!info.isFile() || info.size !== file.sizeBytes) {throw new Error("RUNTIME_CONTENT_CHANGED");}
      const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
      chdHeaders[file.logicalKey] = parseCHDHeader(bytes.subarray(0, bytesRead), info.size);
    } finally {await handle.close();}
  }
  return {chdHeaders};
}

/** The Host supplies bounded headers from its metadata-directory root, never arbitrary runtime filesystem access. */
export function discoverMameMedia(input, catalog) {
  const requirements = input.files.filter(file => /\.zip$/iu.test(file.name)).flatMap(file => {
    const name = file.name.split("/").at(-1).slice(0, -4).toLowerCase();
    return catalog[name] && !catalog[name].bios ? arcadeDiskRequirements(name, catalog) : [];
  });
  if (!requirements.length) {return {files: []};}
  if (input.sourceCandidates === undefined) {return {files: [], sourceSearch: {extensions: ["chd"], headerBytes: 124}};}
  if (!Array.isArray(input.sourceCandidates) || input.sourceCandidates.length > 100000) {throw new Error("RUNTIME_CONTENT_INVALID");}
  const candidates = input.sourceCandidates.flatMap(candidate => {
    if (!safePath(candidate.sourcePath) || typeof candidate.headerBase64 !== "string" || candidate.headerBase64.length > 168 ||
      !Number.isSafeInteger(candidate.sizeBytes) || candidate.sizeBytes < 0) {throw new Error("RUNTIME_CONTENT_INVALID");}
    try {return [{...candidate, ...parseCHDHeader(Buffer.from(candidate.headerBase64, "base64"), candidate.sizeBytes)}];}
    catch {return [];}
  });
  const files = [];
  for (const {path, disk} of requirements) {
    const matches = candidates.filter(candidate => disk.sha1 && candidate.sha1 === disk.sha1);
    matches.sort((a, b) => Number(Boolean(a.parentSHA1)) - Number(Boolean(b.parentSHA1)) ||
      Number(b.sourcePath === path) - Number(a.sourcePath === path) ||
      (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0));
    if (matches.length) {files.push({logicalKey: path, sourcePath: matches[0].sourcePath, optional: true});}
  }
  return {files};
}
