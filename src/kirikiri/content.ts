import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {fileContentSource, materializeFileBytes} from "../provider/content-inputs.js";
import {eagerPolicy, rangePolicy} from "../provider/content-policies.js";
import {LazyContentReader} from "../provider/lazy-reader.js";
import {contentLimits} from "../content-io/limits.js";
import {abi, contractSha256} from "../content-io/identity.js";
import {ContentIOError} from "../content-io/errors.js";
export class KirikiriContent {
  readonly abi = abi;
  readonly contractSha256 = contractSha256;
  private readonly readers = new Set<LazyContentReader>();
  private readonly releases = new Set<() => Promise<void>>();
  private readonly urls = new Set<string>();
  constructor(private readonly options: AdapterContentOptions, private readonly signal?: AbortSignal) {}
  register(projectDigest: string, path: string, url: string, sizeBytes: number) {
    const policy = rangePolicy("VLFS", contentLimits.indexedFile, { writes: "SESSION_OVERLAY"});
    const reader = new LazyContentReader(this.options.contentSession, {identity: {kind: "INDEX_ENTRY", projectDigest, logicalPath: path},
      url, sizeBytes, purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG",
      contentLengthPolicy: policy.contentLengthPolicy, }, policy, this.signal);
    this.readers.add(reader); return reader;
  }
  async assets(base: URL) {
    const files = ["vlfs.js", "index.js", "index.wasm"];
    const blobs: string[] = [];
    for (const file of files) {
      const identity = this.identity(file);
      const bytes = await materializeFileBytes(this.options.contentSession, {...identity, url: new URL(file, base).href},
        eagerPolicy(64 * 1024 * 1024), "CORE_ASSET", this.signal);
      const type = file === "index.wasm" ? "application/wasm" : "text/javascript";
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], {type}));
      this.urls.add(url); blobs.push(url);
    }
    const policy = eagerPolicy(16 * 1024 * 1024, {result: "BLOB"});
    const reader = await this.options.contentSession.open(fileContentSource({...this.identity("assets.zip"),
      url: new URL("assets.zip", base).href}, policy, "CORE_ASSET"), policy, this.signal);
    try {
      const result = await this.options.contentSession.materialize(reader.id, {kind: "BLOB", maxBytes: policy.maxFileBytes}, this.signal);
      if (result.kind !== "BLOB") {throw new ContentIOError("INTERNAL");}
      this.releases.add(result.release);
      return {vlfsUrl: blobs[0], scriptUrl: blobs[1], wasmUrl: blobs[2], archive: result.blob};
    } finally {await reader.close();}
  }
  async close() {
    await Promise.all([...this.readers].map(reader => reader.close())); this.readers.clear();
    await Promise.all([...this.releases].map(release => release())); this.releases.clear();
    for (const url of this.urls) {URL.revokeObjectURL(url);} this.urls.clear();
  }
  private identity(file: string) {
    const identity = this.options.assetIndex[`assets/kirikiri/${file}`];
    if (!identity) {throw new ContentIOError("SOURCE_INVALID");} return identity;
  }
}
