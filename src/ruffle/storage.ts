import type {CheckpointAvailability, RuntimeCheckpoint} from "../contract.js";

export const ruffleSaveFormat = "ruffle-sharedobjects-v1";
export const maximumRuffleSaveBytes = 8 * 1024 * 1024;
const maximumDataBytes = 4 * 1024 * 1024;
type Save = {schemaVersion: 1; identity: string; files: [string, string][]};

/** Each Launch starts empty unless an explicit, identity-bound restore is supplied. */
export class RuffleStorage {
  private files = new Map<string, string>();
  private baseline: string;
  private current: string;
  private revision = 0;

  constructor(private identity: string, restore?: Uint8Array | null) {
    if (!/^[a-f0-9]{64}$/u.test(identity)) {throw invalid();}
    if (restore) {this.files = new Map(decode(restore, identity).files);}
    this.current = this.serialize();
    this.baseline = this.current;
  }

  get(name: string): Uint8Array | null {
    const data = this.files.get(name);
    return data === undefined ? null : fromBase64(data);
  }

  put(name: string, bytes: Uint8Array): boolean {
    if (!validName(name) || !ArrayBuffer.isView(bytes) || bytes.byteLength > maximumDataBytes) {return false;}
    const encoded = toBase64(bytes);
    if (this.files.get(name) === encoded) {return true;}
    const candidate = new Map(this.files);
    candidate.set(name, encoded);
    if (!validFiles([...candidate])) {return false;}
    this.files = candidate;
    this.changed();
    return true;
  }

  remove(name: string) {if (this.files.delete(name)) {this.changed();}}

  availability(): CheckpointAvailability {
    const save = {capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false, dataKind: "STORAGE"} as const;
    if (this.current !== this.baseline) {return {available: true, blocker: null, revision: String(this.revision), save};}
    return {available: false, blocker: this.files.size ? "UNCHANGED" : "NO_SAVE", save};
  }

  async checkpoint(): Promise<RuntimeCheckpoint> {
    if (!this.availability().available) {throw new Error("RUFFLE_SAVE_UNAVAILABLE");}
    return {format: ruffleSaveFormat, bytes: new TextEncoder().encode(this.current)};
  }

  async acknowledge(checkpoint: RuntimeCheckpoint) {
    if (checkpoint.format !== ruffleSaveFormat) {throw invalid();}
    const parsed = decode(checkpoint.bytes, this.identity);
    this.baseline = JSON.stringify(parsed);
  }

  private changed() {this.current = this.serialize(); this.revision++;}
  private serialize() {
    return JSON.stringify({schemaVersion: 1, identity: this.identity, files: [...this.files].sort(([a], [b]) => a < b ? -1 : 1)});
  }
}

function decode(bytes: Uint8Array, identity: string): Save {
  if (!bytes.byteLength || bytes.byteLength > maximumRuffleSaveBytes) {throw invalid();}
  try {
    const value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)) as Save;
    if (!value || Object.keys(value).sort().join(",") !== "files,identity,schemaVersion" ||
      value.schemaVersion !== 1 || value.identity !== identity || !validFiles(value.files)) {throw invalid();}
    let previous = "";
    for (const [name] of value.files) {if (name <= previous) {throw invalid();} previous = name;}
    return {schemaVersion: 1, identity, files: value.files};
  } catch {throw invalid();}
}

function validFiles(files: [string, string][]) {
  if (!Array.isArray(files) || files.length > 128) {return false;}
  let bytes = 0;
  for (const entry of files) {
    if (!Array.isArray(entry) || entry.length !== 2 || !validName(entry[0]) || typeof entry[1] !== "string" ||
      entry[1].length > Math.ceil(maximumDataBytes / 3) * 4 || entry[1].length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(entry[1])) {return false;}
    const data = fromBase64(entry[1]);
    if (toBase64(data) !== entry[1]) {return false;}
    bytes += data.byteLength;
    if (bytes > maximumDataBytes) {return false;}
  }
  return true;
}

function validName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= 1024 &&
    !name.includes("\\") && [...name].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127) && !name.startsWith("/") &&
    name.split("/").every((part) => part !== "." && part !== "..");
}
function toBase64(bytes: Uint8Array) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));}
  return btoa(text);
}
function fromBase64(text: string) {return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));}
function invalid() {return new Error("RUFFLE_SAVE_INVALID");}
