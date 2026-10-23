import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {fetchMetadataJson, indexByteBudget} from "../provider/metadata.js";
import {parseProjectIndex} from "../provider/project-index.js";
import {checkSignal, combineSignals} from "../content-io/abort.js";
import {ContentIOError} from "../content-io/errors.js";
import {LazyContentReader} from "../provider/lazy-reader.js";
import {validateReadBounds} from "../content-io/source.js";

export class SiglusContent {
  private readonly readers = new Map<string, LazyContentReader>();
  private closed = false;
  private readonly controller = new AbortController();
  private readonly scope: ReturnType<typeof combineSignals>;
  private readonly pending = new Set<Promise<unknown>>();
  constructor(private readonly options: AdapterContentOptions) {
    this.scope = combineSignals([this.controller.signal, ...(options.signal ? [options.signal] : [])]);
  }

  project(indexURL: string, contentDigest: string) {
    return this.track(this.load(indexURL, contentDigest));
  }
  readonly read = (path: string, offset: number, length: number): Uint8Array | Promise<Uint8Array> => {
    this.check(); checkSignal(this.scope.signal);
    const reader = this.readers.get(path);
    if (!reader) {throw new ContentIOError("SOURCE_INVALID");}
    validateReadBounds(reader.sizeBytes, offset, length);
    const bytes = new Uint8Array(length);
    if (reader.tryReadInto(offset, bytes) === length) {return bytes;}
    return this.track(reader.readInto(offset, bytes, this.scope.signal).then(count => {
      if (count !== length) {throw new ContentIOError("LENGTH_MISMATCH");}
      return bytes;
    }));
  };
  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    return operation.finally(() => this.pending.delete(operation));
  }
  private async load(indexURL: string, contentDigest: string) {
    const {contentSession: session} = this.options, signal = this.scope.signal;
    const base = new URL(indexURL, location.href);
    const index = parseProjectIndex(await fetchMetadataJson(base, indexByteBudget(100000, 4096), signal), 100000, "UNIQUE_FOLDED");
    if (!index) {throw new Error("SIGLUS_PROJECT_INDEX_INVALID");}
    const policy = session.inputPolicy("game"), files: {path: string; sizeBytes: number}[] = [];
    for (const file of index.files) {
      checkSignal(signal); this.check();
      const url = new URL(file.url, base);
      if (url.origin !== base.origin || file.sizeBytes > policy.maxFileBytes) {throw new ContentIOError("SOURCE_INVALID");}
      this.readers.set(file.path, new LazyContentReader(session,
        {identity: {kind: "INDEX_ENTRY", projectDigest: contentDigest, logicalPath: file.path},
          sizeBytes: file.sizeBytes, url: url.href, purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG",
          contentLengthPolicy: policy.contentLengthPolicy}, policy, signal));
      files.push({path: file.path, sizeBytes: file.sizeBytes});
    }
    return files;
  }
  async close() {
    this.closed = true;
    this.controller.abort();
    await Promise.allSettled([...this.pending]);
    this.scope.dispose();
    const readers = [...this.readers.values()]; this.readers.clear();
    let failed: {reason: unknown} | undefined;
    for (const reader of readers) {
      try {await reader.close();} catch (reason) {failed ??= {reason};}
    }
    if (failed) {throw failed.reason;}
  }
  private check() {if (this.closed) {throw new ContentIOError("ABORTED");}}
}
