export type SaveFile = readonly [string, Uint8Array];

/** Preserve the native file envelope while each core owns file names and contents. */
export function nativeFileSaveCodec(options: {
  maximumBytes: number;
  maximumFiles: number;
  errorCode: string;
  validateFiles: (files: readonly SaveFile[]) => void;
}) {
  const invalid = () => new Error(options.errorCode);
  const encodeSave = (identity: string, files: readonly SaveFile[]): Uint8Array => {
    options.validateFiles(files);
    if (!/^[a-f0-9]{64}$/u.test(identity)) {throw invalid();}
    const entries = [...files].sort(([a], [b]) => a < b ? -1 : 1).map(([name, bytes]) => [name, toBase64(bytes)]);
    const bytes = new TextEncoder().encode(JSON.stringify({version: 1, identity, files: entries}));
    if (bytes.length > options.maximumBytes) {throw invalid();}
    return bytes;
  };
  const decodeSave = (bytes: Uint8Array, identity: string): SaveFile[] => {
    if (!bytes.length || bytes.length > options.maximumBytes) {throw invalid();}
    try {
      const value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)) as {
        version: number; identity: string; files: [string, string][];
      };
      if (!value || Object.keys(value).sort().join(",") !== "files,identity,version" || value.version !== 1 ||
        value.identity !== identity || !Array.isArray(value.files) || value.files.length > options.maximumFiles) {throw invalid();}
      const files: SaveFile[] = value.files.map((entry) => {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") {throw invalid();}
        const data = Uint8Array.from(atob(entry[1]), (char) => char.charCodeAt(0));
        if (toBase64(data) !== entry[1]) {throw invalid();}
        return [entry[0], data];
      });
      options.validateFiles(files);
      return files;
    } catch {throw invalid();}
  };
  return {encodeSave, decodeSave};
}

function toBase64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) {text += String.fromCharCode(...bytes.subarray(i, i + 8192));}
  return btoa(text);
}
