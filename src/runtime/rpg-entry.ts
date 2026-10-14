import type {RuntimeContentFile} from "./types.js";
import {configurationFailure} from "./validation.js";
import {parseRuntimeConfiguration} from "./configuration.js";
import {contentHash} from "./identity.js";
import {rpgEntryFiles} from "./rpg-entry-files.js";

/** Read-only editor projection, including an unsaved engine choice and an invalid old entry. */
export function rpgEntryCandidates(input: {config: unknown; files: RuntimeContentFile[]; engine?: string}) {
  let config = parseRuntimeConfiguration(input.config);
  if (config.content.kind !== "RPG_MAKER_PROJECT") {configurationFailure();}
  if (input.engine !== undefined) {
    config = parseRuntimeConfiguration({...config, content: {...config.content, engine: input.engine}});
  }
  if (config.content.kind !== "RPG_MAKER_PROJECT") {configurationFailure();}
  contentHash(input.files, "TREE");
  return {entries: rpgEntryFiles(config.content.engine, input.files)};
}
