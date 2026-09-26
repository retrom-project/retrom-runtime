import type {EjsInstance} from "./emulator-instance.js";
import type {LaunchEnvelopeV1, RuntimeCheckpointAvailabilityV1, RuntimeCheckpointV1} from "../../provider/module-api.js";
import {decodeStoredCheckpoint} from "../../provider/checkpoint-storage.js";

// Native Lutro files are written by the core under the libretro save directory.
// This container is deliberately uncompressed; the Provider checkpoint boundary
// applies its single, bounded gzip layer to every Target.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", {fatal: true});
const magic = new Uint8Array([82, 76, 78, 83]); // RLNS
const maxFiles = 256;

export type LutroSaveFs = {
  analyzePath: (path: string) => {exists: boolean};
  isDir: (mode: number) => boolean;
  mkdir: (path: string) => void;
  readFile: (path: string) => ArrayBufferView;
  readdir: (path: string) => string[];
  rmdir: (path: string) => void;
  stat: (path: string) => {mode: number; size: number};
  unlink: (path: string) => void;
  writeFile: (path: string, bytes: Uint8Array) => void;
};

function unavailable(): never {throw new Error("PLAYER_STATE_UNAVAILABLE");}

function safePath(path: string) {
  return path.length > 0 && path.length <= 240 && ![...path].some(ch => ch === "\\" || ch.charCodeAt(0) < 32) &&
    path.split("/").every(part => part.length > 0 && part !== "." && part !== "..");
}

function rootFor(fileName: string) {
  if (!safePath(fileName) || fileName.includes("/") || !fileName.toLowerCase().endsWith(".lutro")) {unavailable();}
  const base = fileName.slice(0, -6);
  if (!base) {unavailable();}
  // RetroArch scopes RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY by core name.
  return `/data/saves/lutro/lutro-native/${base}`;
}

function collect(fs: LutroSaveFs, root: string, maximum: number) {
  const files: Array<{name: string; bytes: Uint8Array}> = [];
  let total = 0;
  function visit(directory: string, prefix: string, depth: number) {
    if (depth > 8) {unavailable();}
    for (const name of fs.readdir(directory)) {
      if (name === "." || name === "..") {continue;}
      const relative = prefix ? `${prefix}/${name}` : name;
      if (!safePath(relative)) {unavailable();}
      const path = `${directory}/${name}`;
      if (fs.isDir(fs.stat(path).mode)) {visit(path, relative, depth + 1); continue;}
      if (files.length >= maxFiles) {unavailable();}
      const size = fs.stat(path).size;
      if (!Number.isSafeInteger(size) || size < 0 || total + size > maximum) {unavailable();}
      const view = fs.readFile(path);
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
      if (bytes.length !== size) {unavailable();}
      total += size;
      files.push({name: relative, bytes});
    }
  }
  if (fs.analyzePath(root).exists) {visit(root, "", 0);}
  if (!files.length || !total) {unavailable();}
  return files.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function captureLutroNativeSave(fs: LutroSaveFs, fileName: string, maximum: number) {
  const root = rootFor(fileName);
  const files = collect(fs, root, maximum);
  const identity = encoder.encode(fileName);
  const names = files.map(file => encoder.encode(file.name));
  const size = 12 + identity.length + files.reduce((sum, file, index) => sum + 6 + names[index].length + file.bytes.length, 0);
  if (size > maximum || identity.length > 65535 || files.length > 65535) {unavailable();}
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(magic);
  view.setUint32(4, 1, true);
  view.setUint16(8, identity.length, true);
  view.setUint16(10, files.length, true);
  let offset = 12;
  bytes.set(identity, offset); offset += identity.length;
  for (let i = 0; i < files.length; ++i) {
    view.setUint16(offset, names[i].length, true); offset += 2;
    view.setUint32(offset, files[i].bytes.length, true); offset += 4;
    bytes.set(names[i], offset); offset += names[i].length;
    bytes.set(files[i].bytes, offset); offset += files[i].bytes.length;
  }
  return bytes;
}

function parse(bytes: Uint8Array, fileName: string, maximum: number) {
  if (bytes.length < 12 || bytes.length > maximum || !magic.every((value, index) => bytes[index] === value)) {unavailable();}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 1) {unavailable();}
  const identitySize = view.getUint16(8, true), count = view.getUint16(10, true);
  if (count < 1 || count > maxFiles || 12 + identitySize > bytes.length) {unavailable();}
  let offset = 12;
  if (decoder.decode(bytes.subarray(offset, offset + identitySize)) !== fileName) {unavailable();}
  offset += identitySize;
  const files: Array<{name: string; bytes: Uint8Array}> = [];
  const names = new Set<string>();
  let total = 0;
  for (let i = 0; i < count; ++i) {
    if (offset + 6 > bytes.length) {unavailable();}
    const nameSize = view.getUint16(offset, true), dataSize = view.getUint32(offset + 2, true);
    offset += 6;
    if (offset + nameSize + dataSize > bytes.length) {unavailable();}
    const name = decoder.decode(bytes.subarray(offset, offset + nameSize)); offset += nameSize;
    if (!safePath(name) || names.has(name)) {unavailable();}
    names.add(name);
    const data = bytes.subarray(offset, offset + dataSize).slice(); offset += dataSize;
    total += dataSize;
    files.push({name, bytes: data});
  }
  if (offset !== bytes.length || !total) {unavailable();}
  return files;
}

function removeTree(fs: LutroSaveFs, path: string) {
  if (!fs.analyzePath(path).exists) {return;}
  for (const name of fs.readdir(path)) {
    if (name === "." || name === "..") {continue;}
    const child = `${path}/${name}`;
    if (fs.isDir(fs.stat(child).mode)) {removeTree(fs, child);}
    else {fs.unlink(child);}
  }
  fs.rmdir(path);
}

export function importLutroNativeSave(fs: LutroSaveFs, fileName: string, bytes: Uint8Array | null, maximum: number) {
  const root = rootFor(fileName);
  const files = bytes ? parse(bytes, fileName, maximum) : [];
  if (!fs.analyzePath("/data/saves/lutro").exists) {fs.mkdir("/data/saves/lutro");}
  if (!fs.analyzePath("/data/saves/lutro/lutro-native").exists) {fs.mkdir("/data/saves/lutro/lutro-native");}
  removeTree(fs, root);
  fs.mkdir(root);
  for (const file of files) {
    const parts = file.name.split("/");
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      parent += `/${part}`;
      if (!fs.analyzePath(parent).exists) {fs.mkdir(parent);}
    }
    fs.writeFile(`${root}/${file.name}`, file.bytes);
  }
}

export function lutroSaveFs(manager: EjsInstance["gameManager"]): LutroSaveFs {
  const fs = manager?.FS as Partial<LutroSaveFs> | undefined;
  if (!fs || ["analyzePath", "isDir", "mkdir", "readFile", "readdir", "rmdir", "stat", "unlink", "writeFile"]
    .some(name => typeof fs[name as keyof LutroSaveFs] !== "function")) {unavailable();}
  return fs as LutroSaveFs;
}

export function installLutroNativeRestore(runtimeCore: string, instance: EjsInstance, bytes: Uint8Array | null,
  maximum: number, imported: () => void, failed: (error: unknown) => void) {
  if (runtimeCore !== "lutro") {return;}
  const start = instance.startGame;
  const checkCompression = instance.checkCompression;
  if (!start || !checkCompression) {failed(new Error("PLAYER_STATE_RESTORE_COMPATIBILITY_UNAVAILABLE")); return;}
  // Lutro carts are ZIP containers consumed by the core itself. EJS 4.2.3
  // otherwise extracts the Lua files and passes main.lua to the core.
  instance.checkCompression = (data, message, callback) => {
    if (callback) {
      callback("!!notCompressedData", data);
      return Promise.resolve();
    }
    return checkCompression.call(instance, data, message);
  };
  let initialized = false;
  instance.startGame = () => {
    if (!initialized) {
      try {
        importLutroNativeSave(lutroSaveFs(instance.gameManager), instance.fileName ?? "", bytes, maximum);
        initialized = true;
        imported();
      } catch (error) {failed(error); return;}
    }
    return start.call(instance);
  };
}

const saveCapability = {capture: "IN_GAME", restore: "AUTOMATIC", captureAvailable: false,
  dataKind: "STORAGE"} as const;

/** Observe files written by the native core, including writes that bypass JS FS.writeFile. */
export class LutroNativeSaveTracker {
  private availability: RuntimeCheckpointAvailabilityV1 = {available: false, reason: "NOT_READY", save: saveCapability};
  private current: Uint8Array | null = null;
  private revision: string | null = null;
  private acknowledged: string | null = null;
  private firstScan = true;
  private pending: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly instance: EjsInstance, private readonly maximum: number,
    private readonly restored: boolean, private readonly changed: (value: RuntimeCheckpointAvailabilityV1) => void) {}

  start() {
    if (this.timer !== null) {return;}
    void this.refresh().catch(() => this.publish({available: false, reason: "FAILED", save: saveCapability}));
    this.timer = setInterval(() => {
      void this.refresh().catch(() => this.publish({available: false, reason: "FAILED", save: saveCapability}));
    }, 500);
  }

  stop() {
    if (this.timer !== null) {clearInterval(this.timer); this.timer = null;}
  }

  getAvailability() {return {...this.availability, save: saveCapability};}

  refresh(): Promise<void> {
    if (this.pending) {return this.pending;}
    const task = this.scan();
    this.pending = task;
    void task.then(() => {if (this.pending === task) {this.pending = null;}},
      () => {if (this.pending === task) {this.pending = null;}});
    return task;
  }

  async capture() {
    await this.refresh();
    if (!this.current || this.availability.available !== true) {unavailable();}
    return this.current.slice();
  }

  async acknowledge(raw: Uint8Array) {
    await this.refresh();
    if (!this.current || !this.revision || raw.length !== this.current.length ||
      !raw.every((value, index) => value === this.current![index])) {unavailable();}
    this.acknowledged = this.revision;
    this.publish({available: false, reason: "UNCHANGED", save: saveCapability});
  }

  private async scan() {
    let bytes: Uint8Array | null = null;
    try {bytes = captureLutroNativeSave(lutroSaveFs(this.instance.gameManager), this.instance.fileName ?? "", this.maximum);}
    catch (error) {
      if (!(error instanceof Error) || error.message !== "PLAYER_STATE_UNAVAILABLE") {throw error;}
    }
    if (!bytes) {
      this.current = null; this.revision = null;
      this.publish({available: false, reason: "NO_SAVE", save: saveCapability});
      this.firstScan = false;
      return;
    }
    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
    const revision = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
    this.current = bytes; this.revision = revision;
    if (this.firstScan && this.restored) {this.acknowledged = revision;}
    this.firstScan = false;
    this.publish(revision === this.acknowledged
      ? {available: false, reason: "UNCHANGED", save: saveCapability}
      : {available: true, reason: null, revision, save: saveCapability});
  }

  private publish(value: RuntimeCheckpointAvailabilityV1) {
    if (JSON.stringify(value) === JSON.stringify(this.availability)) {return;}
    this.availability = value;
    this.changed(this.getAvailability());
  }
}

export async function acknowledgeLutroStoredSave(tracker: LutroNativeSaveTracker, checkpoint: RuntimeCheckpointV1,
  contract: LaunchEnvelopeV1["runtime"]["checkpoint"], signal: AbortSignal) {
  if (!contract || contract.semantics !== "GAME_SAVE" || !contract.readFormats.includes(checkpoint.format)) {unavailable();}
  const raw = await decodeStoredCheckpoint(checkpoint.bytes, checkpoint.format, contract.maxBytes, signal);
  await tracker.acknowledge(raw);
}
