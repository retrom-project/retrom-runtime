import {canonicalPath, exact, integer, isDigest} from "../content-io/source.js";

export type ProjectIndexFile = {path: string; sizeBytes: number; sha256: string; mediaType: string; url: string};
export type ProjectIndex = {schemaVersion: 1; files: ProjectIndexFile[]};

/** The public file tree contains immutable facts, without engine-specific fields. */
export function parseProjectIndex(value: unknown, maximumFiles: number): ProjectIndex | null {
  if (!exact(value, ["schemaVersion", "files"]) || value.schemaVersion !== 1 ||
    !Array.isArray(value.files) || !value.files.length || value.files.length > maximumFiles) {return null;}
  const paths = new Set<string>();
  let total = 0;
  for (const file of value.files) {
    if (!exact(file, ["path", "sizeBytes", "sha256", "mediaType", "url"]) ||
      !canonicalPath(file.path) || !integer(file.sizeBytes) || !isDigest(file.sha256) ||
      typeof file.mediaType !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:; charset=utf-8)?$/u.test(file.mediaType) ||
      !validURL(file.url) || paths.has(file.path.toLowerCase())) {return null;}
    paths.add(file.path.toLowerCase()); total += file.sizeBytes;
    if (!Number.isSafeInteger(total)) {return null;}
  }
  return value as ProjectIndex;
}

function validURL(value: unknown): value is string {
  if (typeof value !== "string" || !value || /[\\\s]/u.test(value)) {return false;}
  try {
    const url = new URL(value, "https://runtime.invalid/");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash;
  } catch {return false;}
}
