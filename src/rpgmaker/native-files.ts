import type {RpgCheckpointEntry} from "../checkpoint.js";

export type RpgSaveFileSystem = {
  readdir(path: string): string[];
  stat(path: string): {size: number; mode: number};
  readFile(path: string): Uint8Array;
  mkdirTree(path: string): void;
  writeFile(path: string, bytes: Uint8Array): void;
};
export type RpgMutableSaveFileSystem = RpgSaveFileSystem & {unlink(path: string): void; rmdir(path: string): void};

export function readRpgSaveFiles(fs: RpgSaveFileSystem, root: string): RpgCheckpointEntry[] {
  const entries: RpgCheckpointEntry[] = [];
  let total = 0, visited = 0;
  function visit(directory: string, depth: number) {
    if (depth > 16) {throw new Error("RPG_GAME_SAVE_INVALID");}
    const names = fs.readdir(`${root}/${directory}`).filter(name => name !== "." && name !== "..");
    if (names.length > 512) {throw new Error("RPG_GAME_SAVE_INVALID");}
    for (const name of names) {
      if (++visited > 1024) {throw new Error("RPG_GAME_SAVE_INVALID");}
      const key = directory ? `${directory}/${name}` : name;
      if (!safeSavePath(key)) {throw new Error("RPG_GAME_SAVE_INVALID");}
      const path = `${root}/${key}`, stat = fs.stat(path);
      if ((stat.mode & 0xf000) === 0x4000) {visit(key, depth + 1); continue;}
      total += stat.size;
      if (!Number.isSafeInteger(stat.size) || stat.size < 0 || total > 64 * 1024 * 1024 || entries.length >= 512) {
        throw new Error("RPG_GAME_SAVE_INVALID");
      }
      const data = new Uint8Array(fs.readFile(path)).slice();
      if (data.byteLength !== stat.size) {throw new Error("RPG_GAME_SAVE_CHANGED");}
      entries.push({store: "FILESYSTEM", key, mediaType: "application/octet-stream", data});
    }
  }
  try {fs.stat(root);}
  catch (error) {
    if (error && typeof error === "object" && "errno" in error && error.errno === 44) {return entries;}
    throw error;
  }
  visit("", 0);
  return entries;
}

export function installRpgSaveFiles(fs: RpgSaveFileSystem, root: string, entries: RpgCheckpointEntry[]) {
  assertSavePaths(entries);
  fs.mkdirTree(root);
  for (const {key, data} of entries) {
    const parent = key.lastIndexOf("/");
    if (parent >= 0) {fs.mkdirTree(`${root}/${key.slice(0, parent)}`);}
    fs.writeFile(`${root}/${key}`, data);
  }
}

/** Replace a restored directory after IDBFS loads, before the engine can cache its slot index. */
export function replaceRpgSaveFiles(fs: RpgMutableSaveFileSystem, root: string, entries: RpgCheckpointEntry[]) {
  assertSavePaths(entries);
  // Bound and validate the complete existing tree before deleting any native data.
  readRpgSaveFiles(fs, root);
  fs.mkdirTree(root);
  function clear(directory: string) {
    for (const name of fs.readdir(directory).filter(name => name !== "." && name !== "..")) {
      const path = `${directory}/${name}`;
      if ((fs.stat(path).mode & 0xf000) === 0x4000) {clear(path); fs.rmdir(path);}
      else {fs.unlink(path);}
    }
  }
  clear(root);
  installRpgSaveFiles(fs, root, entries);
}

function assertSavePaths(entries: RpgCheckpointEntry[]) {
  for (const entry of entries) {
    if (entry.store !== "FILESYSTEM" || !safeSavePath(entry.key)) {throw new Error("RPG_GAME_SAVE_INVALID");}
  }
}

export function safeSavePath(key: string) {
  return Boolean(key) && key.length <= 1024 && !/[\\:]/u.test(key) && ![...key].some(character => character.charCodeAt(0) < 32) && key.normalize("NFC") === key &&
    key.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
