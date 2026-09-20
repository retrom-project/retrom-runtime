import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {checkSignal} from "../abort.js";
import type {BlockObject} from "../block-pool.js";
import {ContentIOError, fail} from "../errors.js";
import {BLOCK_BYTES, integer, isDigest} from "../source.js";
import {requireGeneration} from "./metadata.js";
import type {PersistentResources} from "./selector.js";
import type {Backing, BlockReceipt, GenerationRecord} from "./types.js";
export const localDigest = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
export class PersistentBacking {
  constructor(readonly resources: PersistentResources, readonly backing: Backing, readonly object: BlockObject, private readonly onCorrupt: () => void = () => {}) {}
  get key() {return this.object.key;}
  get generation() {return this.backing.generation.generation;}
  async pin(etag: string): Promise<void> {
    const {locks, metadata} = this.resources;
    await locks.data(this.key, undefined, async () => {
      const current = requireGeneration(await metadata.generation(this.key, this.generation));
      if (current.pinnedEtag !== null && current.pinnedEtag !== etag) {fail("IDENTITY_CHANGED");}
      if (current.pinnedEtag === etag) {return;}
      await metadata.update(this.key, this.generation, current.revision, (record) => {record.pinnedEtag = etag;});
    });
  }
  async read(index: number, signal: AbortSignal, allowStaged = false): Promise<Uint8Array<ArrayBuffer> | null> {
    const {locks, metadata, data} = this.resources;
    return locks.data(this.key, signal, async () => {
      const current = requireGeneration(await metadata.generation(this.key, this.generation));
      this.matchPin(current);
      const receipt = await metadata.block(this.key, this.generation, index);
      if (!receipt || !this.validReceipt(receipt, index, current) || receipt.provenance === "STAGED_FULL" && current.state !== "COMPLETE" && !allowStaged) {return null;}
      let bytes: Uint8Array<ArrayBuffer>;
      try {bytes = await data.read(receipt, current.state === "COMPLETE");}
      catch (error) {
        checkSignal(signal);
        // Permission, device and transient I/O failures are backend failures, not evidence of corrupt bytes.
        const missing = error instanceof DOMException && error.name === "NotFoundError";
        const invalid = error instanceof ContentIOError && ["CONTENT_IO_CACHE_UNAVAILABLE", "CONTENT_IO_LENGTH_MISMATCH"].includes(error.code);
        if (!missing && !invalid) {throw error;}
        return this.corrupt(current, receipt);
      }
      checkSignal(signal);
      if (bytes.length !== receipt.length || localDigest(bytes) !== receipt.localSha256) {return this.corrupt(current, receipt);}
      return bytes;
    });
  }
  async write(index: number, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal, provenance: BlockReceipt["provenance"] = "RANGE_VALIDATED"): Promise<void> {
    const {locks, metadata, data} = this.resources;
    const digest = localDigest(bytes);
    await locks.data(this.key, signal, async () => {
      const current = requireGeneration(await metadata.generation(this.key, this.generation)); this.matchPin(current);
      const found = await metadata.block(this.key, this.generation, index);
      const existing = found && this.validReceipt(found, index, current) ? found : undefined;
      if (existing && this.validReceipt(existing, index, current)) {
        const actual = await data.read(existing, current.state === "COMPLETE"); checkSignal(signal);
        if (localDigest(actual) !== existing.localSha256) {await this.corrupt(current, existing); return;}
        if (existing.localSha256 !== digest) {fail("IDENTITY_CHANGED");}
        if (current.state === "COMPLETE" || existing.provenance !== "STAGED_FULL" || provenance === "STAGED_FULL") {return;}
      } else if (current.state === "COMPLETE") {fail("IDENTITY_CHANGED");}
      const receipt: BlockReceipt = {objectKey: this.key, generation: this.generation, index, length: bytes.length, localSha256: digest,
        etag: this.object.state.pinnedEtag, provenance, sourceAssurance: this.assurance(), backend: data.backend,
        location: data.location(this.key, this.generation, index), commitRevision: current.revision + 1};
      if (!existing) {await data.write(receipt, bytes);}
      checkSignal(signal);
      await metadata.update(this.key, this.generation, current.revision, (record) => {
        if (record.state === "COMPLETE") {fail("IDENTITY_CHANGED");}
        if (!existing) {record.committedBytes += bytes.length;}
      }, receipt);
    });
  }
  private assurance(): BlockReceipt["sourceAssurance"] {
    switch (this.object.source.etagPolicy) {
      case "EXPECTED_SHA256": return "EXPECTED_ETAG";
      case "PIN_STRONG": return "TRUSTED_IMMUTABLE_INDEX";
      case "IMMUTABLE_ASSET": return "TRUSTED_IMMUTABLE_ASSET";
      case "NONE_FULL_SHA256": return "FULL_SHA256";
    }
  }
  private validReceipt(receipt: BlockReceipt, index: number, current: GenerationRecord): boolean {
    return receipt.objectKey === this.key && receipt.generation === this.generation && receipt.index === index && integer(index) &&
      receipt.etag === current.pinnedEtag && receipt.sourceAssurance === this.assurance() &&
      integer(receipt.commitRevision, 1, current.revision) && receipt.length === Math.min(BLOCK_BYTES, this.object.source.sizeBytes - index * BLOCK_BYTES) && isDigest(receipt.localSha256) &&
      receipt.backend === this.resources.data.backend && receipt.location === this.resources.data.location(this.key, this.generation, index) &&
      ["RANGE_VALIDATED", "STAGED_FULL", "FULL_VERIFIED"].includes(receipt.provenance);
  }
  private matchPin(current: GenerationRecord): void {
    if (this.object.state.pinnedEtag === null) {this.object.state.pinnedEtag = current.pinnedEtag;}
    if (current.pinnedEtag !== null && this.object.state.pinnedEtag !== current.pinnedEtag) {fail("IDENTITY_CHANGED");}
  }
  private async corrupt(current: GenerationRecord, receipt: BlockReceipt): Promise<null> {
    this.onCorrupt();
    if (current.state === "COMPLETE") {
      // Published physical generations are immutable, including in other Sessions.
      await this.resources.metadata.update(this.key, this.generation, current.revision, (record) => {record.state = "QUARANTINED";});
      fail("IDENTITY_CHANGED");
    }
    await this.resources.metadata.update(this.key, this.generation, current.revision, (record) => {
      record.state = "PARTIAL"; record.completionAssurance = null; record.localSha256 = null;
      record.committedBytes = Math.max(0, record.committedBytes - receipt.length);
    }, {deleteIndex: receipt.index});
    return null;
  }
}
