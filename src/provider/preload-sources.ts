import type {ContentSourceV1, ManagedInputPolicyV1} from "../../contracts/content-io/v1/content-io.js";
import {canonicalPath, integer, record, validateSource, type SourceContext} from "../content-io/source.js";
import {fail} from "../content-io/errors.js";
import type {TargetDeclaration} from "./declarations.js";
import type {AssetIndexV1, LaunchEnvelopeV1, RuntimeResourceV1} from "./module-api.js";
import {fileContentSource} from "./content-inputs.js";
import {fetchMetadataJson, indexByteBudget} from "./metadata.js";

/** Resolve exactly the immutable identities used by the managed adapters, before mounting a core. */
export async function preloadSources(target: TargetDeclaration, envelope: LaunchEnvelopeV1,
  assets: AssetIndexV1, context: SourceContext, signal: AbortSignal): Promise<ContentSourceV1[]> {
  const sources: ContentSourceV1[] = [];
  for (const resource of envelope.resources) {
    const policy = target.contentIO[resource.role];
    if (!policy || !("bridge" in policy)) {continue;}
    sources.push(...await resourceSources(resource, policy, signal));
  }
  for (const path of target.preloadAssetPaths ?? []) {
    const identity = assets[path];
    if (!identity || !target.assetPaths.includes(path)) {fail("SOURCE_INVALID");}
    sources.push({identity: {kind: "FILE_SHA256", sha256: identity.sha256}, sizeBytes: identity.sizeBytes,
      url: new URL(path, new URL(envelope.runtime.runtimeBaseUrl, location.href)).href,
      purpose: "CORE_ASSET", transport: "RANGE_REQUIRED", etagPolicy: "IMMUTABLE_ASSET", contentLengthPolicy: "EXACT_IF_PRESENT"});
  }
  return sources.map(source => validateSource(source, context));
}

async function resourceSources(resource: RuntimeResourceV1, policy: ManagedInputPolicyV1, signal: AbortSignal): Promise<ContentSourceV1[]> {
  if (resource.kind === "FILE_TREE" || resource.kind === "NATIVE_WEB" || resource.kind === "ISOLATED_WEB") {
    const base = new URL(resource.indexUrl, location.href);
    const index = await fetchMetadataJson(base, indexByteBudget(100_000, 4096), signal);
    if (!record(index) || index.schemaVersion !== 1 || !Array.isArray(index.files) || index.files.length > 100_000) {fail("SOURCE_INVALID");}
    const seen = new Set<string>();
    return index.files.map(value => {
      if (!record(value) || typeof value.path !== "string" || !canonicalPath(value.path) || seen.has(value.path) ||
        !integer(value.sizeBytes, 0, policy.maxFileBytes) || typeof value.url !== "string") {fail("SOURCE_INVALID");}
      seen.add(value.path);
      const url = new URL(value.url, base);
      if (url.origin !== base.origin) {fail("SOURCE_INVALID");}
      return {identity: {kind: "INDEX_ENTRY", projectDigest: resource.contentDigest, logicalPath: value.path},
        url: url.href, sizeBytes: value.sizeBytes, purpose: "GAME", etagPolicy: "PIN_STRONG",
        transport: policy.mode === "RANGE" ? "RANGE_REQUIRED" : "WHOLE_ALLOWED", contentLengthPolicy: policy.contentLengthPolicy};
    });
  }
  const files = resource.kind === "MULTI_DISC" ? resource.entries :
    resource.kind === "BIOS_BUNDLE" || resource.kind === "EXTERNAL_FILE_SET" ? resource.files :
      "sha256" in resource ? [resource] : [];
  const purpose = resource.role === "game" || resource.role === "discs" || resource.role === "parent" ? "GAME" : "FIRMWARE";
  return files.map(file => {
    if (file.sizeBytes > policy.maxFileBytes) {fail("BOUNDS");}
    return fileContentSource(file, policy, purpose);
  });
}
