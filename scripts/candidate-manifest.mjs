import { access, lstat, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export async function loadCandidateDeclaration(root) {
  const path = join(root, "candidate", "runtime-candidate.json");
  try {await access(path);} catch (error) {
    if (error?.code === "ENOENT") {return null;}
    throw error;
  }
  const value = JSON.parse(await readFile(path, "utf8"));
  const artifactFields = [
    "core_id", "runtime_family", "generation", "route_key", "runtime_adapter_kind",
    "adapter_id", "adapter_abi", "entry_path", "file_paths", "requires_threads",
    "save_payload_kind", "save_max_bytes", "selected_for_new_bindings",
    "available_for_launch", "compatibility",
  ];
  if (!exactKeys(value, [
    "schemaVersion", "kind", "branchCoreId", "adapterSourceModule", "runtimeFiles", "artifact",
  ]) || value.schemaVersion !== 1 || value.kind !== "RETROM_RUNTIME_NEW_CORE_CANDIDATE_V1" ||
    !/^[a-z0-9_]{1,64}$/u.test(value.branchCoreId) || !safeRelative(value.adapterSourceModule) ||
    !value.adapterSourceModule.startsWith("src/") || !exactKeys(value.artifact, artifactFields) ||
    !Array.isArray(value.runtimeFiles) || !value.runtimeFiles.length || value.runtimeFiles.length > 8) {
    throw new Error("PFB_CANDIDATE_OUTPUT_INVALID:new-core-declaration");
  }
  const sourceInfo = await lstat(join(root, value.adapterSourceModule));
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
    throw new Error("PFB_CANDIDATE_OUTPUT_INVALID:new-core-adapter");
  }
  const fileFields = ["candidateFilename", "bundlePath", "pathInRelease", "role", "maxSizeBytes"];
  const validRoles = new Set(["runtime_js", "runtime_wasm", "adapter_bridge", "runtime_asset", "license"]);
  const bundlePaths = new Set();
  const releasePaths = new Set();
  for (const file of value.runtimeFiles) {
    if (!exactKeys(file, fileFields) || basename(file.candidateFilename) !== file.candidateFilename ||
      !safeRelative(file.bundlePath) || !safeRelative(file.pathInRelease) ||
      bundlePaths.has(file.bundlePath) || releasePaths.has(file.pathInRelease) ||
      !validRoles.has(file.role) || !Number.isSafeInteger(file.maxSizeBytes) || file.maxSizeBytes < 1) {
      throw new Error("PFB_CANDIDATE_OUTPUT_INVALID:new-core-file");
    }
    bundlePaths.add(file.bundlePath);
    releasePaths.add(file.pathInRelease);
  }
  validateCandidateArtifact(value.artifact, value.runtimeFiles);
  return value;
}

function validateCandidateArtifact(artifact, files) {
  const strings = [
    "core_id", "runtime_family", "generation", "route_key", "runtime_adapter_kind",
    "adapter_id", "adapter_abi", "entry_path", "save_payload_kind",
  ];
  if (strings.some((field) => typeof artifact[field] !== "string" || !artifact[field]) ||
    !/^[a-z0-9_]{1,64}$/u.test(artifact.core_id) || !safeRelative(artifact.entry_path) ||
    typeof artifact.requires_threads !== "boolean" ||
    typeof artifact.selected_for_new_bindings !== "boolean" ||
    typeof artifact.available_for_launch !== "boolean" ||
    !Number.isSafeInteger(artifact.save_max_bytes) || artifact.save_max_bytes < 1 ||
    !artifact.compatibility || typeof artifact.compatibility !== "object" || Array.isArray(artifact.compatibility) ||
    !Array.isArray(artifact.file_paths)) {
    throw new Error("PFB_CANDIDATE_OUTPUT_INVALID:new-core-artifact");
  }
  const expectedPaths = files.map((file) => file.pathInRelease)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const actualPaths = [...artifact.file_paths]
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (new Set(actualPaths).size !== actualPaths.length ||
    JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths) ||
    !actualPaths.some((path) => path.endsWith(`/${artifact.entry_path}`))) {
    throw new Error("PFB_CANDIDATE_OUTPUT_INVALID:new-core-artifact-files");
  }
}

export function exactKeys(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function safeRelative(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") &&
    !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
}
