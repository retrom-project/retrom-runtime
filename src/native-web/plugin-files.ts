/** Bounded desktop-plugin files; no Node process, network URLs, or host filesystem. */
export type RpgPluginFile = {path: string; data: ArrayBuffer};
const maximumBytes = 16 * 1024 * 1024;
const maximumSaveFiles = 128;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function canonical(path: string) {
  return typeof path === "string" && path.length > 0 && encoder.encode(path).length <= 1024 && !/[\\:?#]/u.test(path) && !path.includes("\0") &&
    path.normalize("NFC") === path && path.split("/").every(part => part && part !== "." && part !== "..");
}
export function isPluginSavePath(path: string) {
  return canonical(path) && /^save\/[^/]+\.rpgsave$/u.test(path);
}
function encoding(value: unknown) {
  const name = typeof value === "object" && value !== null && "encoding" in value ? value.encoding : value;
  if (name === undefined || name === null) {return null;}
  if (name !== "utf8" && name !== "utf-8") {throw new Error("RPG_PLUGIN_ENCODING_UNSUPPORTED");}
  return name;
}
class PluginBytes extends Uint8Array {
  override toString(name: string = "utf8") {encoding(name); return decoder.decode(this);}
}

export function createRpgPluginFiles(href: string, content: RpgPluginFile[]) {
  const root = decodeURIComponent(new URL(".", href).pathname).replace(/www\/$/iu, "");
  const readonly = new Map<string, Uint8Array>();
  let saves = new Map<string, Uint8Array>();
  let size = 0;
  if (!Array.isArray(content) || content.length > 4096) {throw new Error("RPG_PLUGIN_FILES_TOO_LARGE");}
  for (const entry of content) {
    if (!canonical(entry.path) || !/^scenario\/.+\.(sl|txt)$/iu.test(entry.path) ||
      readonly.has(entry.path) || !(entry.data instanceof ArrayBuffer)) {throw new Error("RPG_PLUGIN_FILE_INVALID");}
    size += entry.data.byteLength;
    if (size > maximumBytes) {throw new Error("RPG_PLUGIN_FILES_TOO_LARGE");}
    readonly.set(entry.path, new Uint8Array(entry.data));
  }
  function key(path: string) {
    if (typeof path !== "string") {throw new Error("RPG_PLUGIN_PATH_INVALID");}
    const relative = path.startsWith(root) ? path.slice(root.length) : path;
    if (!canonical(relative)) {throw new Error("RPG_PLUGIN_PATH_INVALID");}
    return relative;
  }
  function writable(path: string) {
    const name = key(path);
    if (!isPluginSavePath(name)) {throw new Error("RPG_PLUGIN_FILE_READ_ONLY");}
    return name;
  }
  function validateSaves(files: RpgPluginFile[]) {
    const result = new Map<string, Uint8Array>();
    let bytes = 0;
    if (files.length > maximumSaveFiles) {throw new Error("RPG_PLUGIN_FILES_TOO_LARGE");}
    for (const file of files) {
      if (!isPluginSavePath(file.path) || result.has(file.path) || !(file.data instanceof ArrayBuffer)) {
        throw new Error("RPG_PLUGIN_FILE_INVALID");
      }
      bytes += file.data.byteLength;
      if (bytes > maximumBytes) {throw new Error("RPG_PLUGIN_FILES_TOO_LARGE");}
      result.set(file.path, new Uint8Array(file.data).slice());
    }
    return result;
  }
  const snapshot = () => [...saves].map(([path, bytes]) => ({path, data: bytes.slice().buffer}));
  const fs = Object.freeze({
    existsSync(path: string) {
      if (path === `${root}save/` || path === `${root}save` || path === "save" || path === "save/") {return true;}
      const name = key(path); return saves.has(name) || readonly.has(name);
    },
    mkdirSync(path: string) {
      if (path !== `${root}save/` && path !== `${root}save` && path !== "save" && path !== "save/") {
        throw new Error("RPG_PLUGIN_FILE_READ_ONLY");
      }
    },
    readFileSync(path: string, options?: unknown) {
      const name = key(path), bytes = saves.get(name) ?? readonly.get(name);
      if (!bytes) {throw new Error("RPG_PLUGIN_FILE_NOT_FOUND");}
      return encoding(options) ? decoder.decode(bytes) : new PluginBytes(bytes);
    },
    writeFileSync(path: string, value: string | Uint8Array, options?: unknown) {
      encoding(options);
      const name = writable(path);
      if (typeof value !== "string" && !(value instanceof Uint8Array)) {throw new Error("RPG_PLUGIN_FILE_INVALID");}
      const bytes = typeof value === "string" ? new Uint8Array(encoder.encode(value)) : value;
      const next = snapshot().filter(file => file.path !== name);
      next.push({path: name, data: bytes.slice().buffer as ArrayBuffer});
      saves = validateSaves(next);
    },
    unlinkSync(path: string) {
      if (!saves.delete(writable(path))) {throw new Error("RPG_PLUGIN_FILE_NOT_FOUND");}
    },
  });
  return {fs, saveDirectory: `${root}save/`, snapshot,
    restore(files: RpgPluginFile[]) {saves = validateSaves(files);},
    close() {saves.clear(); readonly.clear();},
  };
}
