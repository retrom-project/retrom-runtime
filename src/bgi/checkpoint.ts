import {fileSaveCodec, type FileSaveSnapshot} from "../provider/file-save-codec.js";
export const bgiSaveFormat = "bgi-save-files-v1";
export const bgiSaveMaximum = 128 * 1024 * 1024;
export type BgiSnapshot = FileSaveSnapshot & {format: "bgi-save-files"};
const codec = fileSaveCodec({format: "bgi-save-files", maximum: bgiSaveMaximum, decodedMaximum: 64 * 1024 * 1024, deletions: false,
  invalid: "BGI_CHECKPOINT_INVALID", noSave: "BGI_NO_SAVE",
  progress: (path, size) => /(?:^|\/)(?:bgi\d{4,}\.cad|[^/]*\d{3,}\.sud)$/u.test(path) && size > 64});
export const encodeBgiSave = codec.encode;
export const decodeBgiSave = (bytes: Uint8Array, identity: string) => codec.decode(bytes, identity) as BgiSnapshot;
