import type {RuntimeConfiguration, RuntimeContentFile} from "./types.js";
import type {TargetDeclaration} from "../provider/declarations.js";
import type {TargetOptionsV1} from "../provider/module-api.js";
import {configurationFailure} from "./validation.js";

function rootNames(files: readonly RuntimeContentFile[], entry: string) {
  const root = entry.slice(0, entry.lastIndexOf("/") + 1).toLowerCase();
  return new Set(files.filter(file => file.logicalKey.toLowerCase().startsWith(root))
    .map(file => file.logicalKey.slice(root.length).toLowerCase()));
}
export function siglusLanguage(files: readonly RuntimeContentFile[], entry: string) {
  const names = rootNames(files, entry);
  return names.has("scene.chs") && names.has("gameexe.chs") ? "chs" : "original";
}
export function validateSiglusOptions(config: RuntimeConfiguration, target: TargetDeclaration,
  options: TargetOptionsV1, files: readonly RuntimeContentFile[]) {
  if (target.id !== "siglus" || config.content.kind !== "SIGLUS_PROJECT") {return;}
  const names = rootNames(files, config.content.entryFile);
  if (!names.has("gameexe.dat") && !names.has("gameexe.ini")) {configurationFailure("RUNTIME_ENTRY_MISSING");}
  if (options.language === "chs" && (!names.has("scene.chs") || !names.has("gameexe.chs"))) {
    configurationFailure("RUNTIME_SIGLUS_TRANSLATION_MISSING");
  }
}
