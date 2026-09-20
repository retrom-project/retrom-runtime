import type {ContentReaderV1, ContentSourceV1, ManagedInputPolicyV1} from "../../contracts/content-io/v1/content-io.js";
import type {AdapterContentSession} from "./content-inputs.js";
import {abi} from "../content-io/identity.js";
import {checkSignal, combineSignals, abortable} from "../content-io/abort.js";
import {validateReadBounds, BLOCK_BYTES, integer} from "../content-io/source.js";
import {fail} from "../content-io/errors.js";
/** Metadata registration remains free of Worker channels and I/O. No byte cache lives here. */
export class LazyContentReader implements ContentReaderV1 {
  readonly abi = abi;
  readonly id = crypto.randomUUID();
  readonly sizeBytes: number;
  private readonly controller = new AbortController();
  private pending?: Promise<ContentReaderV1>;
  private current?: ContentReaderV1;
  private closing?: Promise<void>;
  constructor(private readonly session: AdapterContentSession, private readonly source: ContentSourceV1,
    private readonly policy: ManagedInputPolicyV1, private readonly signal?: AbortSignal) {this.sizeBytes = source.sizeBytes;}
  async readInto(offset: number, destination: Uint8Array, signal?: AbortSignal): Promise<number> {
    this.check(); validateReadBounds(this.sizeBytes, offset, destination.byteLength); checkSignal(signal);
    const combined = combineSignals([this.controller.signal, ...(this.signal ? [this.signal] : []), ...(signal ? [signal] : [])]);
    try {
      const reader = await abortable(this.reader(), combined.signal); this.check();
      return await reader.readInto(offset, destination, combined.signal);
    } finally {combined.dispose();}
  }
  tryReadInto(offset: number, destination: Uint8Array): number | null {
    this.check(); validateReadBounds(this.sizeBytes, offset, destination.byteLength);
    return this.current?.tryReadInto(offset, destination) ?? (destination.length === 0 ? 0 : null);
  }
  async *stream(offset: number, length: number, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    this.check(); checkSignal(signal);
    if (!integer(offset) || !integer(length) || offset > this.sizeBytes - length) {fail("BOUNDS");}
    for (let done = 0; done < length;) {
      const bytes = new Uint8Array(Math.min(BLOCK_BYTES, length - done));
      await this.readInto(offset + done, bytes, signal); yield bytes; done += bytes.length;
    }
  }
  close(): Promise<void> {
    this.controller.abort();
    return this.closing ??= (async () => {await (await this.pending?.catch(() => undefined))?.close();})();
  }
  private check() {checkSignal(this.controller.signal); checkSignal(this.signal);}
  private reader(): Promise<ContentReaderV1> {
    this.check();
    if (!this.pending) {
      const combined = combineSignals([this.controller.signal, ...(this.signal ? [this.signal] : [])]);
      this.pending = this.session.open(this.source, this.policy, combined.signal).then(async reader => {
        if (combined.signal.aborted) {await reader.close(); checkSignal(combined.signal);}
        this.current = reader; return reader;
      }).finally(combined.dispose);
    }
    return this.pending;
  }
}
