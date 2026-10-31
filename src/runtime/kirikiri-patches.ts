import type {ConfigureRequest} from "./configure.js";
import {hashBytes} from "./identity.js";
import type {RuntimeConfiguration, RuntimeContentFile} from "./types.js";
import {configurationFailure, digest, exact, logicalPath, object, utf8Compare} from "./validation.js";

type Input = Pick<ConfigureRequest, "files" | "evidence">;
type Fact = Pick<RuntimeContentFile, "logicalKey" | "sha256" | "sizeBytes">;
type Patch = {overlayRoot: string; optionRoot: string; label: string};
type ManifestFile = {file: RuntimeContentFile; projectRoot: string; module: string};
type FileIndex = ReadonlyMap<string, RuntimeContentFile>;
const manifestBytes = 256 * 1024;
const maximumResources = 10_000;
const maximumPatches = 62;
const manifestPattern = /^(.*\/)?\.runtime-launches\/([^/]+)\.json$/u;

/** Shared with evidence readers so only recognized metadata files need bounded text reads. */
export function isKirikiriPatchManifest(path: string): boolean {return manifestPattern.test(path);}

/** Every alternative preserves entry selection and independent copies of all unrelated core options. */
export function kirikiriPatchLaunches(input: Input & {configuration: RuntimeConfiguration}): {
  items: {id: string; label: string; configuration: RuntimeConfiguration}[]; selectedId: string;
} {
  const {configuration} = input;
  if (configuration.content.kind !== "KIRIKIRI_PROJECT") {return {items: [], selectedId: ""};}
  const patches = discover(input, configuration.content.entryFile);
  if (!patches.length) {return {items: [], selectedId: ""};}
  const items = [{id: "original", label: "原版资源", configuration: withOverlay(configuration)}];
  items.push(...patches.map(patch => ({id: patch.overlayRoot, label: patch.label,
    configuration: withOverlay(configuration, patch.optionRoot)})));
  const current = configuration.cores?.kirikiri2?.options?.overlayRoot;
  if (typeof current !== "string") {return {items, selectedId: "original"};}
  const active = patches.find(patch => patch.optionRoot === current);
  if (active) {return {items, selectedId: active.overlayRoot};}
  const selectedId = `custom:${current}`;
  items.push({id: selectedId, label: "自定义覆盖目录", configuration: structuredClone(configuration)});
  return {items, selectedId};
}

/** Import may select one proven patch; ambiguity requires an explicit launch choice. */
export function defaultKirikiriPatchOptions(input: Input & {entryFile?: string}): {overlayRoot: string} | undefined {
  const patches = discover(input, input.entryFile);
  if (patches.length > 1) {
    configurationFailure("RUNTIME_LAUNCH_REQUIRED", {candidates: JSON.stringify(patches.map(patch => patch.overlayRoot))});
  }
  return patches.length ? {overlayRoot: patches[0].optionRoot} : undefined;
}

function discover(input: Input, entryFile?: string): Patch[] {
  const projectRoot = entryFile === undefined ? undefined : directory(entryFile);
  const manifests = input.files.flatMap(file => {
    const match = manifestPattern.exec(file.logicalKey);
    if (!match || projectRoot !== undefined && (match[1] ?? "") !== projectRoot) {return [];}
    return [{file, projectRoot: match[1] ?? "", module: match[2]}];
  });
  if (!manifests.length) {return [];}
  if (manifests.length > maximumPatches) {invalid(manifests[0].file.logicalKey, "too many resource patch manifests");}
  manifests.sort((left, right) => utf8Compare(left.file.logicalKey, right.file.logicalKey));
  const files = new Map(input.files.map(file => [file.logicalKey, file]));
  if (files.size !== input.files.length) {invalid(manifests[0].file.logicalKey, "duplicate content paths");}
  const patches = manifests.map(manifest => parseManifest(input, files, manifest));
  if (new Set(patches.map(patch => patch.overlayRoot)).size !== patches.length) {
    invalid(manifests[0].file.logicalKey, "duplicate overlay roots");
  }
  return patches;
}

function parseManifest(input: Input, files: FileIndex, {file, projectRoot, module}: ManifestFile): Patch {
  const path = file.logicalKey;
  const text = manifestText(input, file);
  let value: unknown;
  try {value = JSON.parse(text);} catch {invalid(path, "invalid JSON");}
  if (!object(value) || !exact(value, ["kind", "version", "sourceFiles", "overlayRoot", "resources"]) ||
    value.kind !== "KIRIKIRI_RESOURCE_PATCH" || value.version !== 1) {invalid(path, "invalid manifest schema");}
  const overlayRoot = value.overlayRoot;
  if (!logicalPath(overlayRoot) || !overlayRoot.startsWith(`${projectRoot}.runtime-patches/`)) {
    invalid(path, "overlay root must be a safe directory in the same project");
  }
  const optionRoot = overlayRoot.slice(projectRoot.length);
  if (optionRoot.length > 240) {invalid(path, "overlay root exceeds the core option length limit");}
  const sources = factList(value.sourceFiles, files, path);
  for (const source of sources) {
    const relative = source.logicalKey.slice(projectRoot.length);
    if (!source.logicalKey.startsWith(projectRoot) || [".runtime-patches", ".runtime-launches"].includes(relative.split("/")[0])) {
      invalid(path, "source files must belong to the project's original resources");
    }
  }
  const resources = factList(value.resources, files, path);
  const resourcePaths = new Set(resources.map(resource => resource.logicalKey));
  if (!resources.every(resource => resource.logicalKey.startsWith(`${overlayRoot}/`))) {
    invalid(path, "resources must be inside their overlay root");
  }
  for (const key of files.keys()) {
    if (key.startsWith(`${overlayRoot}/`) && !resourcePaths.has(key)) {invalid(path, "unlisted overlay resource");}
  }
  return {overlayRoot, optionRoot, label: `资源补丁：${module}`};
}

function manifestText(input: Input, file: RuntimeContentFile): string {
  const text = input.evidence?.[file.logicalKey]?.text;
  if (!logicalPath(file.logicalKey) || !digest(file.sha256) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 ||
    file.sizeBytes > manifestBytes || typeof text !== "string" || text.length > manifestBytes) {
    invalid(file.logicalKey, "manifest requires bounded text evidence");
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.length !== file.sizeBytes || hashBytes(bytes) !== file.sha256) {
    invalid(file.logicalKey, "manifest evidence does not match immutable file facts");
  }
  return text;
}

function factList(value: unknown, files: FileIndex, manifest: string): Fact[] {
  if (!Array.isArray(value) || !value.length || value.length > maximumResources) {
    invalid(manifest, "file lists must contain between 1 and 10000 entries");
  }
  const seen = new Set<string>();
  return value.map(entry => {
    if (!object(entry) || !exact(entry, ["logicalKey", "sizeBytes", "sha256"]) || !logicalPath(entry.logicalKey) ||
      !digest(entry.sha256) || !Number.isSafeInteger(entry.sizeBytes) || (entry.sizeBytes as number) < 0 || seen.has(entry.logicalKey)) {
      invalid(manifest, "invalid or duplicate file fact");
    }
    const actual = files.get(entry.logicalKey);
    if (!actual || actual.sizeBytes !== entry.sizeBytes || actual.sha256 !== entry.sha256) {
      invalid(manifest, "referenced file facts do not match content");
    }
    seen.add(entry.logicalKey);
    return {logicalKey: entry.logicalKey, sizeBytes: entry.sizeBytes as number, sha256: entry.sha256};
  });
}

function withOverlay(configuration: RuntimeConfiguration, overlayRoot?: string): RuntimeConfiguration {
  const result = structuredClone(configuration);
  if (overlayRoot !== undefined) {
    result.cores ??= {};
    result.cores.kirikiri2 ??= {};
    result.cores.kirikiri2.options ??= {};
    result.cores.kirikiri2.options.overlayRoot = overlayRoot;
  } else if (result.cores?.kirikiri2) {
    const core = result.cores.kirikiri2;
    if (core.options) {
      delete core.options.overlayRoot;
      if (!Object.keys(core.options).length) {delete core.options;}
    }
    if (!Object.keys(core).length) {delete result.cores.kirikiri2;}
    if (!Object.keys(result.cores).length) {delete result.cores;}
  }
  return result;
}

function directory(path: string): string {return path.slice(0, path.lastIndexOf("/") + 1);}
function invalid(manifest: string, reason: string): never {
  configurationFailure("RUNTIME_PATCH_MANIFEST_INVALID", {manifest, reason});
}
