import {type RpgCheckpointBundle, type RpgCheckpointEntry, type RpgCheckpointStore} from "../checkpoint.js";
import {RpgGameSaves} from "../rpgmaker/game-saves.js";
import {isPluginSavePath, type RpgPluginFile} from "./plugin-files.js";

type Forage = {
  clear(): Promise<unknown>;
  keys(): Promise<string[]>;
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: string): Promise<unknown>;
};
type SaveWindow = {localStorage: Storage; localforage?: Forage;
  DataManager?: {maxSavefiles?(): number; makeSavename?(slot: number): string};
  StorageManager?: {forageTestKey?(): string; webStorageKey?(slot: number): string; forageKey?(name: string): string}};
type PluginFiles = {snapshot(): RpgPluginFile[]; restore(files: RpgPluginFile[]): void};
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", {fatal: true});
const maximumBytes = 64 * 1024 * 1024;

/** Raw native storage is installed before engine boot; no DataManager save/load or scene manipulation. */
export function createRpgWebSaves(global: SaveWindow, engine: "RPGMV" | "RPGMZ",
  initial: unknown, pluginFiles: PluginFiles | null) {
  const restored = initial === null ? null : readWebSaveBundle(initial, engine);
  let forage: RpgCheckpointEntry[] = [];
  let ready = false;
  let initialization: Promise<void> | null = null;
  const read = () => {
    const entries: RpgCheckpointEntry[] = [];
    const storage = global.localStorage;
    if (storage.length > 512) {throw new Error("RPG_GAME_SAVE_INVALID");}
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key !== null) {entries.push(textEntry("LOCAL_STORAGE", key, storage.getItem(key)!));}
    }
    for (const file of pluginFiles?.snapshot() ?? []) {entries.push({store: "FILESYSTEM", key: file.path,
      mediaType: "application/octet-stream", data: new Uint8Array(file.data)});}
    entries.push(...forage);
    validateSize(entries);
    return entries;
  };
  const saves = new RpgGameSaves(engine, read, restored, entry => isProgress(entry, global, engine));
  // localStorage and desktop files are available as soon as CONNECT arrives, including to plugin scripts.
  if (restored) {global.localStorage.clear();}
  for (const entry of restored?.entries ?? []) {
    if (entry.store === "LOCAL_STORAGE") {global.localStorage.setItem(entry.key, decoder.decode(entry.data));}
  }
  if (pluginFiles) {pluginFiles.restore((restored?.entries ?? []).filter(entry => entry.store === "FILESYSTEM")
    .map(entry => ({path: entry.key, data: entry.data.slice().buffer})));}
  const refresh = async () => {
    if (engine !== "RPGMZ") {return;}
    const storage = global.localforage;
    if (!storage) {throw new Error("RPG_GAME_SAVE_STORAGE_UNAVAILABLE");}
    const keys = await storage.keys();
    if (keys.length > 512) {throw new Error("RPG_GAME_SAVE_INVALID");}
    const entries = [];
    for (const key of keys.sort()) {
      if (key === global.StorageManager?.forageTestKey?.()) {continue;}
      const value = await storage.getItem(key);
      if (value !== null) {entries.push(textEntry("LOCALFORAGE", key, value));}
    }
    validateSize(entries);
    forage = entries;
  };
  return {
    initialize() {
      return initialization ??= (async () => {
        if (engine === "RPGMZ") {
          if (!global.localforage) {throw new Error("RPG_GAME_SAVE_STORAGE_UNAVAILABLE");}
          if (restored) {await global.localforage.clear();}
          for (const entry of restored?.entries ?? []) {
            if (entry.store === "LOCALFORAGE") {await global.localforage.setItem(entry.key, decoder.decode(entry.data));}
          }
        }
        await refresh(); ready = true;
      })();
    },
    async availability() {if (!ready) {return {available: false, blocker: "NOT_READY"} as const;} await refresh(); return saves.availability();},
    async capture() {if (!ready) {throw new Error("RPG_GAME_SAVE_NOT_READY");} await refresh(); return saves.capture();},
    acknowledge(bundle: unknown) {saves.acknowledgeBundle(readWebSaveBundle(bundle, engine));},
    isReady: () => ready,
  };
}

export function readWebSaveBundle(value: unknown, engine: "RPGMV" | "RPGMZ"): RpgCheckpointBundle {
  if (!value || typeof value !== "object" || !("engine" in value) || value.engine !== engine ||
    !("entries" in value) || !Array.isArray(value.entries) || !value.entries.length || value.entries.length > 512) {
    throw new Error("RPG_GAME_SAVE_INVALID");
  }
  const entries: RpgCheckpointEntry[] = [], seen = new Set<string>();
  for (const entry of value.entries as Array<Record<string, unknown>>) {
    const parsed = parseWebEntry(entry, engine);
    const identity = `${entry.store}\0${entry.key}`;
    if (seen.has(identity)) {throw new Error("RPG_GAME_SAVE_INVALID");}
    seen.add(identity);
    entries.push(parsed);
  }
  validateSize(entries);
  return {engine, entries};
}

function parseWebEntry(entry: Record<string, unknown>, engine: "RPGMV" | "RPGMZ"): RpgCheckpointEntry {
  if (!entry || typeof entry !== "object" || typeof entry.key !== "string" || !entry.key ||
    encoder.encode(entry.key).length > 1024 || entry.key.includes("\0") || entry.key.normalize("NFC") !== entry.key ||
    entry.mediaType !== "application/octet-stream" || !(entry.data instanceof ArrayBuffer) ||
    !validStore(entry.store, entry.key, engine)) {throw new Error("RPG_GAME_SAVE_INVALID");}
  const data = new Uint8Array(entry.data).slice();
  if (entry.store !== "FILESYSTEM") {decoder.decode(data);}
  return {store: entry.store as RpgCheckpointStore, key: entry.key, data, mediaType: "application/octet-stream"};
}
function validStore(store: unknown, key: string, engine: "RPGMV" | "RPGMZ") {
  return store === "LOCAL_STORAGE" || engine === "RPGMZ" && store === "LOCALFORAGE" ||
    engine === "RPGMV" && store === "FILESYSTEM" && isPluginSavePath(key);
}

function textEntry(store: RpgCheckpointStore, key: string, value: unknown): RpgCheckpointEntry {
  if (typeof value !== "string" || !key || encoder.encode(key).length > 1024 || key.includes("\0") || key.normalize("NFC") !== key) {
    throw new Error("RPG_GAME_SAVE_INVALID");
  }
  return {store, key, mediaType: "application/octet-stream", data: encoder.encode(value)};
}
function validateSize(entries: RpgCheckpointEntry[]) {
  if (entries.length > 512 || entries.reduce((total, entry) => total + entry.data.byteLength, 0) > maximumBytes) {
    throw new Error("RPG_GAME_SAVE_INVALID");
  }
}
function isProgress(entry: RpgCheckpointEntry, global: SaveWindow, engine: "RPGMV" | "RPGMZ") {
  if (entry.store === "FILESYSTEM") {return /(?:^|\/)file\d+\.rpgsave$/iu.test(entry.key);}
  const maximum = global.DataManager?.maxSavefiles?.();
  if (typeof maximum !== "number" || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 512) {return false;}
  try {
    for (let slot = engine === "RPGMZ" ? 0 : 1; slot <= maximum; slot++) {
      if (nativeProgressKey(global, engine, entry.store, slot) === entry.key) {return true;}
    }
  } catch { /* The native key can depend on the database, which is unavailable before engine boot. */ }
  return false;
}

function nativeProgressKey(global: SaveWindow, engine: "RPGMV" | "RPGMZ", store: RpgCheckpointStore, slot: number) {
  if (engine === "RPGMV" && store === "LOCAL_STORAGE") {return global.StorageManager?.webStorageKey?.(slot);}
  if (engine === "RPGMZ" && store === "LOCALFORAGE") {
    const name = global.DataManager?.makeSavename?.(slot);
    return name === undefined ? undefined : global.StorageManager?.forageKey?.(name);
  }
  return undefined;
}
