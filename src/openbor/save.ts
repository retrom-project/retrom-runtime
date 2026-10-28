import {nativeFileSaveCodec, type SaveFile} from "../provider/native-file-save.js";
export const saveFormat = "openbor-game-save-v1";
export const maximumSaveBytes = 16 * 1024 * 1024;
export type {SaveFile} from "../provider/native-file-save.js";
export const {encodeSave, decodeSave} = nativeFileSaveCodec({
  maximumBytes: maximumSaveBytes, maximumFiles: 128, errorCode: "OPENBOR_SAVE_INVALID", validateFiles,
});
export function isSaveName(name: string) {return /^game\.(?:sav|hi|s[0-9]{2})$/u.test(name);}
function validateFiles(files: readonly SaveFile[]) {
  if (!files.length || files.length > 128 || !files.some(([name]) => name === "game.sav")) {throw invalid();}
  const names = new Set<string>();
  let size = 0;
  for (const [name, bytes] of files) {
    if (!isSaveName(name) || names.has(name) || !ArrayBuffer.isView(bytes) || !bytes.byteLength) {throw invalid();}
    names.add(name); size += bytes.byteLength;
    if (size > 10 * 1024 * 1024) {throw invalid();}
  }
}
function invalid() {return new Error("OPENBOR_SAVE_INVALID");}
