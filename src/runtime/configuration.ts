import type {RuntimeConfiguration, RuntimeContent, RuntimeContentFile} from "./types.js";
import {configurationFailure, exact, identifier, logicalPath, object} from "./validation.js";

const entryKinds = ["SINGLE_FILE", "ARCADE", "ONS_PROJECT", "KIRIKIRI_PROJECT", "BUTTERSCOTCH_PROJECT",
  "TYRANOSCRIPT_PROJECT", "NXENGINE_PROJECT", "DAPHNE_PROJECT"];
const engines = ["RPG2000", "RPG2003", "RPGXP", "RPGVX", "RPGVXACE", "RPGMV", "RPGMZ"];

/** Accept only game-specific rules; declarations and installed BIOS are resolved at launch. */
export function parseRuntimeConfiguration(value: unknown): RuntimeConfiguration {
  if (!object(value) || !exact(value, ["content"], ["cores"])) {configurationFailure();}
  const content = parseContent(value.content);
  if (value.cores !== undefined) {
    if (!object(value.cores) || Object.keys(value.cores).length > 128) {configurationFailure();}
    for (const [coreId, core] of Object.entries(value.cores)) {
      if (!identifier(coreId) || !object(core) || !exact(core, [], ["parentFiles", "options"])) {configurationFailure();}
      if (core.options !== undefined && !object(core.options)) {configurationFailure();}
      if (core.parentFiles !== undefined && (content.kind !== "ARCADE" || !Array.isArray(core.parentFiles) ||
        core.parentFiles.length > 32 || !core.parentFiles.every(path => logicalPath(path)) ||
        new Set(core.parentFiles).size !== core.parentFiles.length)) {configurationFailure();}
    }
  }
  // The returned object cannot be mutated by the caller after an async launch starts.
  return structuredClone(value) as RuntimeConfiguration;
}

function parseContent(value: unknown): RuntimeContent {
  if (!object(value) || typeof value.kind !== "string") {configurationFailure();}
  if (value.kind === "SCUMMVM_PROJECT") {
    if (!exact(value, ["kind"])) {configurationFailure();}
  } else if (value.kind === "DOS_BUNDLE") {
    if (!exact(value, ["kind", "entryFile"], ["entryPath"]) || !logicalPath(value.entryFile) ||
      value.entryPath !== undefined && !logicalPath(value.entryPath)) {configurationFailure();}
  } else if (value.kind === "RPG_MAKER_PROJECT") {
    if (!exact(value, ["kind", "entryFile", "engine"]) || !logicalPath(value.entryFile) || !engines.includes(String(value.engine))) {configurationFailure();}
  } else if (!entryKinds.includes(value.kind) || !exact(value, ["kind", "entryFile"]) || !logicalPath(value.entryFile)) {configurationFailure();}
  return value as RuntimeContent;
}

export function validateConfigurationFiles(config: RuntimeConfiguration, files: readonly RuntimeContentFile[]): void {
  const paths = new Set(files.map(file => file.logicalKey));
  if ("entryFile" in config.content && !paths.has(config.content.entryFile)) {
    configurationFailure("RUNTIME_ENTRY_MISSING", {logicalKey: config.content.entryFile});
  }
  for (const core of Object.values(config.cores ?? {})) {
    for (const path of core.parentFiles ?? []) {
      if (!paths.has(path)) {configurationFailure("RUNTIME_PARENT_MISSING", {logicalKey: path});}
    }
  }
}
