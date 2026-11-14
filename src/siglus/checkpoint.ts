import {fileSaveCodec, type FileSaveSnapshot} from "../provider/file-save-codec.js";
export const siglusSaveFormat = "siglus-save-files-v1";
export const siglusSaveMaximum = 128 * 1024 * 1024;
export type SiglusSnapshot = FileSaveSnapshot & {format: "siglus-save-files"};
const codec = fileSaveCodec({format: "siglus-save-files", maximum: siglusSaveMaximum, decodedMaximum: siglusSaveMaximum,
  invalid: "SIGLUS_CHECKPOINT_INVALID", noSave: "SIGLUS_NO_SAVE",
  progress: (path, size) => /^savedata\/(?:.*\/)?\d+\.sav$/u.test(path) && size > 0});
export const encodeSiglusSave = codec.encode;
export const decodeSiglusSave = (bytes: Uint8Array, identity: string) => codec.decode(bytes, identity) as SiglusSnapshot;
