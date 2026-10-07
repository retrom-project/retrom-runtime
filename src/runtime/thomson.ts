import type {RuntimeContentFile} from "./types.js";
import type {TargetOptionsV1} from "../provider/module-api.js";

// Matches the pinned Theodore autodetect_model order and its exact lower/upper
// spellings. The core receives the resource basename, not the display title.
const automaticModels = [
  ["to8d", "TO8D"], ["to8", "TO8"], ["to9p", "TO9+"], ["to9", "TO9"],
  ["to770", "TO7/70"], ["to7", "TO7"], ["mo6", "MO6"], ["pc128", "PC128"],
  ["mo5", "MO5"], ["memo5", "MO5"], [".m5", "MO5"], ["memo7", "TO8"], [".m7", "TO8"],
] as const;

export function thomsonModelOptions(options: TargetOptionsV1, entryFile: string, files: readonly RuntimeContentFile[]): TargetOptionsV1 {
  if (options.thomsonModel !== undefined && options.thomsonModel !== "Auto") {return options;}
  const filename = files.find(file => file.logicalKey === entryFile)?.name.split("/").at(-1) ?? "";
  const model = automaticModels.find(([pattern]) => filename.includes(pattern) || filename.includes(pattern.toUpperCase()))?.[1] ?? "TO8";
  return {...options, thomsonModel: model};
}
