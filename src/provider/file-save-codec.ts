export type FileSaveSnapshot = {format: string; version: 1; scope: string; files: {path: string; data: string | null}[]};
type FileSavePolicy = {format: string; maximum: number; decodedMaximum: number; deletions?: boolean; invalid: string; noSave: string; progress(path: string, sizeBytes: number): boolean};
export function fileSaveCodec(policy: FileSavePolicy) {
  const decode = (bytes: Uint8Array, identity: string): FileSaveSnapshot => {
    if (!bytes.byteLength || bytes.byteLength > policy.maximum) {invalid(policy);}
    let value: unknown;
    try {value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));} catch {invalid(policy);}
    validate(value, identity, policy); return value;
  };
  const encode = (snapshot: FileSaveSnapshot, identity: string): Uint8Array => {
    validate(snapshot, identity, policy);
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    if (bytes.byteLength > policy.maximum) {invalid(policy);} return bytes;
  };
  return {encode, decode};
}
function validate(value: unknown, identity: string, policy: FileSavePolicy): asserts value is FileSaveSnapshot {
  if (!record(value) || Object.keys(value).sort().join() !== "files,format,scope,version" ||
    value.format !== policy.format || value.version !== 1 || value.scope !== identity ||
    !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 10000) {invalid(policy);}
  let previous = "", progress = false, decoded = 0;
  for (const entry of value.files) {
    if (!validEntry(entry) || entry.path <= previous || entry.data === null && policy.deletions === false) {invalid(policy);}
    previous = entry.path;
    if (typeof entry.data === "string") {
      const size = decodedSize(entry.data);
      decoded += size;
      if (decoded > policy.decodedMaximum) {invalid(policy);}
      if (policy.progress(entry.path, size)) {progress = true;}
    }
  }
  if (!progress) {throw new Error(policy.noSave);}
}
function decodedSize(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return data.length / 4 * 3 - padding;
}
function validEntry(value: unknown): value is FileSaveSnapshot["files"][number] {
  return record(value) && Object.keys(value).sort().join() === "data,path" && validPath(value.path) &&
    (value.data === null || typeof value.data === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value.data));
}
function validPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 4096 && !/[A-Z\\:]/u.test(path) &&
    ![...path].some(char => char.charCodeAt(0) < 32) && !path.startsWith("/") &&
    !path.split("/").some(part => !part || part === "." || part === "..");
}
function record(value: unknown): value is Record<string, unknown> {return value !== null && typeof value === "object" && !Array.isArray(value);}
function invalid(policy: FileSavePolicy): never {throw new Error(policy.invalid);}
