export const saveFormat = "nxengine-game-save-v1";
export const maximumSaveBytes = 16384;
export type SaveFile = readonly [string, Uint8Array];
const encoder = new TextEncoder();
export function encodeSave(identity: string, files: readonly SaveFile[]): Uint8Array {
  validateFiles(files);
  if (!/^[a-f0-9]{64}$/u.test(identity)) {throw invalid();}
  const entries = [...files].sort(([a], [b]) => a < b ? -1 : 1).map(([name, bytes]) => [name, toBase64(bytes)]);
  const bytes = encoder.encode(JSON.stringify({version: 1, identity, files: entries}));
  if (bytes.length > maximumSaveBytes) {throw invalid();}
  return bytes;
}
export function decodeSave(bytes: Uint8Array, identity: string): SaveFile[] {
  if (!bytes.length || bytes.length > maximumSaveBytes) {throw invalid();}
  try {
    const value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)) as {
      version: number; identity: string; files: [string, string][];
    };
    if (!value || Object.keys(value).sort().join(",") !== "files,identity,version" || value.version !== 1 ||
      value.identity !== identity || !Array.isArray(value.files) || value.files.length > 5) {throw invalid();}
    const files: SaveFile[] = value.files.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") {throw invalid();}
      const data = Uint8Array.from(atob(entry[1]), (char) => char.charCodeAt(0));
      if (toBase64(data) !== entry[1]) {throw invalid();}
      return [entry[0], data];
    });
    validateFiles(files);
    return files;
  } catch {throw invalid();}
}
export function isSaveName(name: string) {return /^profile(?:[2-5])?\.dat$/u.test(name);}
function validateFiles(files: readonly SaveFile[]) {
  if (!files.length || files.length > 5) {throw invalid();}
  const names = new Set<string>();
  let size = 0;
  for (const [name, bytes] of files) {
    if (!isSaveName(name) || names.has(name) || !ArrayBuffer.isView(bytes) || bytes.byteLength !== 0x604 || new TextDecoder().decode(bytes.subarray(0, 8)) !== "Do041220") {throw invalid();}
    names.add(name); size += bytes.byteLength;
    if (size > 5 * 0x604) {throw invalid();}
  }
}
function toBase64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) {text += String.fromCharCode(...bytes.subarray(i, i + 8192));}
  return btoa(text);
}
function invalid() {return new Error("NXENGINE_SAVE_INVALID");}
