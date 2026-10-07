type CacheNode = {[key: string]: string | CacheNode};

/** The pinned engine's gencache V2 lookup differs from the public file index. */
export function easyRpgProjectIndex(paths: readonly string[]) {
  const cache: CacheNode = Object.create(null);
  for (const path of [...paths].sort()) {addPath(cache, path.split("/"));}
  return {metadata: {version: 2}, cache};
}

function addPath(cache: CacheNode, segments: string[]) {
  let node = cache;
  for (let index = 0; index < segments.length; index++) {
    const name = segments[index], file = index === segments.length - 1;
    const key = file ? fileKey(name, index === 0) : normalize(name);
    if (key === "_dirname") {invalid();}
    const existing = node[key];
    if (file) {
      if (existing !== undefined) {invalid();}
      node[key] = name;
    } else if (existing === undefined) {
      const child: CacheNode = Object.create(null); child._dirname = name;
      node[key] = child; node = child;
    } else {
      if (typeof existing === "string" || existing._dirname !== name) {invalid();}
      node = existing;
    }
  }
}

function fileKey(name: string, root: boolean) {
  const key = normalize(name), stem = key.replace(/\.[^./]*$/u, "");
  if (stem === "exfont") {return stem;}
  return root || /\.(?:ini|po)$/u.test(key) ? key : stem;
}
function normalize(value: string) {return value.toLowerCase().normalize("NFKC");}
function invalid(): never {throw new Error("RPG_RUNTIME_PACK_INVALID");}
