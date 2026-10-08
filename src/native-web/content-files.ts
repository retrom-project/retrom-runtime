import type {ContentReaderV1, ContentSourceV1, ManagedInputPolicyV1} from "../../contracts/content-io/v1/content-io.js";
import {ContentIOError} from "../content-io/errors.js";
import {canonicalPath, integer, record} from "../content-io/source.js";
import type {ContentSessionAccess} from "../provider/content-inputs.js";
import {fetchMetadataJson, indexByteBudget} from "../provider/metadata.js";
import type {RuntimeWebResourceV1} from "../provider/module-api.js";

type File = {source: ContentSourceV1; mediaType: string; reader?: Promise<ContentReaderV1>};
export class NativeContentFiles {
  private readonly files = new Map<string, File>();
  private readonly folded = new Map<string, string | null>();
  private closed = false;
  constructor(private readonly session: ContentSessionAccess, private readonly policy: ManagedInputPolicyV1,
    private readonly signal?: AbortSignal) {}
  async load(resource: RuntimeWebResourceV1): Promise<void> {
    const base = new URL(resource.indexUrl, location.href);
    const value = await fetchMetadataJson(base, indexByteBudget(100_000, 4096), this.signal);
    if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.files) || value.files.length > 100_000) {throw invalid();}
    for (const item of value.files) {
      const {path, file} = parseEntry(item, base, resource.contentDigest, this.policy.maxFileBytes);
      if (this.files.has(path)) {throw invalid();}
      this.files.set(path, file);
      const folded = asciiFold(path);
      this.folded.set(folded, this.folded.has(folded) ? null : path);
    }
    if (!canonicalPath(resource.entryFile) || !this.files.has(resource.entryFile)) {throw invalid();}
  }
  async request(value: unknown): Promise<Record<string, unknown>> {
    if (this.closed || this.signal?.aborted) {throw new ContentIOError("ABORTED");}
    if (!record(value) || typeof value.path !== "string" || !canonicalPath(value.path)) {throw invalid();}
    const path = value.path.normalize("NFC");
    const name = this.files.has(path) ? path : this.folded.get(asciiFold(path));
    const file = name ? this.files.get(name) : undefined;
    if (!file) {return {status: 404};}
    if (value.type === "STAT") {return {status: 200, path: name, sizeBytes: file.source.sizeBytes, mediaType: file.mediaType};}
    if (value.type !== "READ" || !integer(value.offset) || !integer(value.length, 0, 262144) ||
      value.offset > file.source.sizeBytes || value.length > file.source.sizeBytes - value.offset) {throw invalid();}
    file.reader ??= this.session.open(file.source, this.policy, this.signal);
    const reader = await file.reader;
    const bytes = new Uint8Array(value.length);
    await reader.readInto(value.offset, bytes, this.signal);
    return {status: 200, bytes};
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.files.values()].map(async file => (await file.reader)?.close()));
    this.files.clear(); this.folded.clear();
  }
}
function asciiFold(value: string) {return value.replace(/[A-Z]/gu, character => character.toLowerCase());}
function invalid() {return new ContentIOError("SOURCE_INVALID");}

function parseEntry(item: unknown, base: URL, digest: string, maximum: number): {path: string; file: File} {
  if (!record(item) || typeof item.path !== "string" || !canonicalPath(item.path) ||
    !integer(item.sizeBytes, 0, maximum) || typeof item.url !== "string" ||
    typeof item.mediaType !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:; charset=utf-8)?$/u.test(item.mediaType)) {throw invalid();}
  const url = new URL(item.url, base);
  if (url.origin !== base.origin || url.username || url.password || url.hash) {throw invalid();}
  return {path: item.path, file: {mediaType: item.mediaType, source: {
    identity: {kind: "INDEX_ENTRY", projectDigest: digest, logicalPath: item.path},
    url: url.href, sizeBytes: item.sizeBytes, purpose: "GAME", transport: "RANGE_REQUIRED",
    etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT",
  }}};
}
