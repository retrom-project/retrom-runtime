import type {ConfigureRequest} from "./configure.js";
import {configurationFailure, utf8Compare} from "./validation.js";

const xp3Signature = [0x58, 0x50, 0x33, 0x0d, 0x0a, 0x20, 0x0a, 0x1a, 0x8b, 0x67, 0x01];
export const kirikiriArchiveProbeBytes = xp3Signature.length;
type Input = Pick<ConfigureRequest, "files" | "evidence" | "selection">;

/** Engine conventions and actual format evidence, never game titles or host storage names. */
export function kirikiriEntryCandidates(input: Input): string[] {
  return input.files.filter(file => /(?:^|\/)startup\.tjs$|\.xp3$/iu.test(file.logicalKey) || isXP3(input, file.logicalKey))
    .map(file => file.logicalKey).sort(utf8Compare);
}

export function kirikiriEntry(input: Input): string {
  const candidates = kirikiriEntryCandidates(input);
  if (input.selection?.entryFile) {
    if (!candidates.includes(input.selection.entryFile)) {configurationFailure("RUNTIME_ENTRY_MISSING");}
    return input.selection.entryFile;
  }
  if (!candidates.length) {configurationFailure("RUNTIME_ENTRY_MISSING");}
  // Compare project roots before entry conventions, including different entry types.
  const root = candidates.map(directory).reduce((left, right) => right.length < left.length ? right : left);
  if (!candidates.every(path => path.startsWith(root))) {
    configurationFailure("RUNTIME_ENTRY_REQUIRED", {candidates: JSON.stringify(candidates)});
  }
  const project = candidates.filter(path => directory(path) === root);
  const preferred = [
    project.filter(path => /(?:^|\/)startup\.tjs$/iu.test(path)),
    project.filter(path => /(?:^|\/)data\.xp3$/iu.test(path)),
    project.filter(path => /(?:^|\/)data\.[^/]+$/iu.test(path) && isXP3(input, path)),
    project,
  ];
  for (const tier of preferred) {
    if (!tier.length) {continue;}
    if (tier.length === 1) {return tier[0];}
    configurationFailure("RUNTIME_ENTRY_REQUIRED", {candidates: JSON.stringify(tier)});
  }
  configurationFailure("RUNTIME_ENTRY_MISSING");
}

function directory(path: string) {return path.slice(0, path.lastIndexOf("/") + 1);}
function isXP3(input: Input, path: string): boolean {
  const prefix = input.evidence?.[path]?.prefixBase64;
  if (prefix === undefined) {return false;}
  let bytes: string;
  try {bytes = atob(prefix);} catch {configurationFailure("RUNTIME_EVIDENCE_INVALID");}
  const file = input.files.find(file => file.logicalKey === path)!;
  if (bytes.length !== Math.min(file.sizeBytes, kirikiriArchiveProbeBytes)) {configurationFailure("RUNTIME_EVIDENCE_INVALID");}
  return xp3Signature.every((byte, index) => bytes.charCodeAt(index) === byte);
}
