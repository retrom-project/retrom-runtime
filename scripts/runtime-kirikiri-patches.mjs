import {TextDecoder} from "node:util";
import {contentHash, isKirikiriPatchManifest, kirikiriPatchLaunches, parseRuntimeConfiguration,
  RuntimeConfigurationError} from "../dist/runtime/index.js";
import {contentStream} from "./runtime-host-content.mjs";
import {requireLocator, sha256} from "./runtime-archive-input.mjs";

const maximumManifests = 62;
const maximumBytes = 256 * 1024;

/** Metadata always comes from its exact immutable managed interval, including when evidence was supplied. */
export async function withKirikiriPatchEvidence(input, signal) {
  signal?.throwIfAborted();
  const manifests = input.files.filter(file => isKirikiriPatchManifest(file.logicalKey));
  if (manifests.length > maximumManifests) {invalid(manifests[0].logicalKey, "too many resource patch manifests");}
  const evidence = {...input.evidence};
  for (const file of manifests) {
    signal?.throwIfAborted();
    const text = await readManifest(input, file, signal);
    const previous = evidence[file.logicalKey];
    if (previous?.text !== undefined && previous.text !== text) {throw new Error("RUNTIME_CONTENT_CHANGED");}
    evidence[file.logicalKey] = {...previous, text};
  }
  signal?.throwIfAborted();
  return {...input, evidence};
}

/** Launch alternatives are read-only projections; saved explicit options remain unchanged. */
export async function hostLaunchOptions(input, signal) {
  signal?.throwIfAborted();
  const configuration = parseRuntimeConfiguration(input.config);
  if (input.platformId !== "kirikiri" || configuration.content.kind !== "KIRIKIRI_PROJECT") {return {items: [], selectedId: ""};}
  contentHash(input.files, "TREE");
  const prepared = await withKirikiriPatchEvidence(input, signal);
  signal?.throwIfAborted();
  return kirikiriPatchLaunches({...prepared, configuration});
}

async function readManifest(input, file, signal) {
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > maximumBytes) {
    invalid(file.logicalKey, "manifest exceeds bounded text evidence");
  }
  const locator = requireLocator(input, file), chunks = [];
  let length = 0;
  try {
    for await (const chunk of contentStream(locator, {signal})) {
      signal?.throwIfAborted();
      length += chunk.length;
      if (length > maximumBytes) {invalid(file.logicalKey, "manifest exceeds bounded text evidence");}
      chunks.push(chunk);
    }
  } catch (cause) {
    signal?.throwIfAborted();
    if (cause instanceof Error && /^RUNTIME_[A-Z0-9_]+$/u.test(cause.message)) {throw cause;}
    throw new Error("RUNTIME_CONTENT_UNAVAILABLE", {cause});
  }
  signal?.throwIfAborted();
  const bytes = Buffer.concat(chunks, length);
  if (length !== file.sizeBytes || sha256(bytes) !== file.sha256) {throw new Error("RUNTIME_CONTENT_CHANGED");}
  try {return new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes);}
  catch {invalid(file.logicalKey, "manifest must contain valid UTF-8");}
}

function invalid(manifest, reason) {throw new RuntimeConfigurationError("RUNTIME_PATCH_MANIFEST_INVALID", {manifest, reason});}
