import type {RuntimeConfiguration, RuntimeContentFile} from "./types.js";

/** A PBP may be an entry into a content tree, while a lone disc stays seekable. */
export function pspProjectEntry(config: RuntimeConfiguration, files: readonly RuntimeContentFile[]): string | null {
  const content = config.content;
  return "entryFile" in content && /\.pbp$/iu.test(content.entryFile) && files.length > 1
    ? content.entryFile.split("/").at(-1)! : null;
}
