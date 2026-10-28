import {nativeFileSaveCodec, type SaveFile} from "../provider/native-file-save.js";
export const saveFormat = "nxengine-game-save-v1";
export const maximumSaveBytes = 16384;
export type {SaveFile} from "../provider/native-file-save.js";
export const {encodeSave, decodeSave} = nativeFileSaveCodec({
  maximumBytes: maximumSaveBytes, maximumFiles: 5, errorCode: "NXENGINE_SAVE_INVALID", validateFiles,
});
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
function invalid() {return new Error("NXENGINE_SAVE_INVALID");}
