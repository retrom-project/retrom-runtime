import type {RpgSaveFileSystem} from "../src/rpgmaker/native-files.js";

export function rpgSaveFileSystem() {
  const files = new Map<string, Uint8Array>(), directories: string[] = [];
  const path = (value: string) => value.replace(/\/$/u, "");
  const fs: RpgSaveFileSystem & {unlink(path: string): void; rmdir(path: string): void;
    analyzePath(path: string): {exists: boolean}; isDir(mode: number): boolean} = {
    analyzePath: value => ({exists: files.has(path(value)) || directories.includes(path(value))}),
    mkdirTree(value) {
      const parts = value.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const name = parts.slice(0, i).join("/");
        if (name && !directories.includes(name)) {directories.push(name);}
      }
    },
    readdir(value) {
      const prefix = path(value) + "/";
      return [...new Set([...files.keys(), ...directories].filter(name => name.startsWith(prefix))
        .map(name => name.slice(prefix.length).split("/")[0]))];
    },
    stat(value) {
      const name = path(value), bytes = files.get(name);
      if (bytes) {return {size: bytes.length, mode: 0x8000};}
      if (directories.includes(name)) {return {size: 0, mode: 0x4000};}
      throw Object.assign(Error("ENOENT"), {errno: 44});
    },
    isDir: mode => mode === 0x4000,
    unlink(value) {if (!files.delete(path(value))) {throw Error("ENOENT");}},
    rmdir(value) {
      const name = path(value), index = directories.indexOf(name);
      if (index < 0) {throw Error("ENOENT");}
      if ([...files.keys(), ...directories].some(item => item.startsWith(name + "/"))) {throw Error("ENOTEMPTY");}
      directories.splice(index, 1);
    },
    readFile(value) {const bytes = files.get(path(value)); if (!bytes) {throw Error("ENOENT");} return bytes;},
    writeFile(value, bytes) {
      if (!directories.includes(value.slice(0, value.lastIndexOf("/")))) {return;}
      files.set(value, bytes.slice());
    },
  };
  return {files, directories, fs};
}
