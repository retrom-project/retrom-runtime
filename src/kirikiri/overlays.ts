import {canonicalPath} from "../content-io/source.js";

/** Keep exact filenames and selection order; native startup mounting stays independent. */
export function kirikiriOverlayArchives(value: unknown): string[] {
  if (value === undefined) {return [];}
  if (!Array.isArray(value) || value.length > 32 || !value.every(path =>
    canonicalPath(path) && path.length <= 240 && !/[>\ud800-\udfff]/u.test(path) && /\.xp3$/iu.test(path)) ||
    new Set(value).size !== value.length) {throw new Error("KIRIKIRI_OVERLAY_ARCHIVES_INVALID");}
  return value.slice() as string[];
}

export function kirikiriResourceOverlayFiles(paths: readonly string[], root: string | null, archives: readonly string[]) {
  const available = new Set(paths);
  const rooted = root === null ? [] : paths.filter(path => path.startsWith(`${root}/`));
  if (root !== null && !rooted.length || archives.some(path => !available.has(path))) {
    throw new Error("KIRIKIRI_PROJECT_OVERLAY_INVALID");
  }
  const rootPaths = new Set(rooted);
  const files = archives.filter(path => !rootPaths.has(path)).map((path, index) => {
    // The native resource-overlay ABI sorts relative paths before reading XP3
    // members. Only archive aliases carry order; mounted content paths stay exact.
    return {path: `/${path}`, relativePath: `0/${String(index).padStart(2, "0")}.xp3`};
  });
  if (root === null) {return files;}
  for (const path of rooted) {
    let relativePath = path.slice(root.length + 1);
    // Root archives retain their lexical order above the explicitly ordered
    // archives. The native ABI applies loose resources after all archives.
    if (archives.length && /\.xp3$/iu.test(relativePath)) {relativePath = `1/${relativePath}`;}
    files.push({path: `/${path}`, relativePath});
  }
  return files;
}
