export const siglusSaveFormat = "siglus-save-files-v1";
export const siglusSaveMaximum = 128 * 1024 * 1024;
export type SiglusSnapshot = {format: "siglus-save-files"; version: 1; scope: string; files: {path: string; data: string | null}[]};

export function decodeSiglusSave(bytes: Uint8Array, identity: string): SiglusSnapshot {
  if (!bytes.byteLength || bytes.byteLength > siglusSaveMaximum) {invalid();}
  let value: unknown;
  try {value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));} catch {invalid();}
  validate(value, identity);
  return value;
}
export function encodeSiglusSave(snapshot: SiglusSnapshot, identity: string): Uint8Array {
  validate(snapshot, identity);
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (bytes.byteLength > siglusSaveMaximum) {invalid();}
  return bytes;
}
function validate(value: unknown, identity: string): asserts value is SiglusSnapshot {
  if (!record(value) || Object.keys(value).sort().join() !== "files,format,scope,version" ||
    value.format !== "siglus-save-files" || value.version !== 1 || value.scope !== identity ||
    !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 10000) {invalid();}
  let previous = "", progress = false, decoded = 0;
  for (const entry of value.files) {
    if (!validEntry(entry) || entry.path <= previous) {invalid();}
    previous = entry.path;
    if (typeof entry.data === "string") {
      decoded += entry.data.length / 4 * 3;
      if (decoded > siglusSaveMaximum) {invalid();}
      if (/^savedata\/(?:.*\/)?\d+\.sav$/u.test(entry.path) && entry.data.length > 0) {progress = true;}
    }
  }
  if (!progress) {throw new Error("SIGLUS_NO_SAVE");}
}
function validEntry(value: unknown): value is SiglusSnapshot["files"][number] {
  return record(value) && Object.keys(value).sort().join() === "data,path" && validPath(value.path) &&
    (value.data === null || typeof value.data === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value.data));
}
function validPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 4096 && !/[A-Z\\:]/u.test(path) &&
    ![...path].some(char => char.charCodeAt(0) < 32) && !path.startsWith("/") &&
    !path.split("/").some(part => !part || part === "." || part === "..");
}
function record(value: unknown): value is Record<string, unknown> {return value !== null && typeof value === "object" && !Array.isArray(value);}
function invalid(): never {throw new Error("SIGLUS_CHECKPOINT_INVALID");}
