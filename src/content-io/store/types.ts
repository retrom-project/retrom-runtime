import type {ContentIdentityV1, ContentSourceV1, MaterializationReceiptV1} from "../../../contracts/content-io/v1/content-io.js";
export const namespace = "retrom-content-io-v1";
export type Backend = "OPFS" | "CACHE_BLOCKS";
export type ObjectState = "PARTIAL" | "VERIFYING" | "COMPLETE" | "QUARANTINED";
export type GenerationRecord = {
  objectKey: string; generation: string; backend: Backend; state: ObjectState; pinnedEtag: string | null;
  completionAssurance: MaterializationReceiptV1["assurance"] | null; localSha256: string | null;
  committedBytes: number; revision: number; retiredAtMs: number | null;
};
export type ObjectRecord = Omit<GenerationRecord, "objectKey" | "retiredAtMs"> & {
  key: string; identity: ContentIdentityV1; sizeBytes: number; purpose: ContentSourceV1["purpose"]; sourceOrigin: string; lastAccessMs: number;
};
export type BlockReceipt = {
  objectKey: string; generation: string; index: number; length: number; localSha256: string; etag: string | null;
  provenance: "RANGE_VALIDATED" | "STAGED_FULL" | "FULL_VERIFIED";
  sourceAssurance: "EXPECTED_ETAG" | "TRUSTED_IMMUTABLE_INDEX" | "TRUSTED_IMMUTABLE_ASSET" | "FULL_SHA256";
  backend: Backend; location: string; commitRevision: number;
};
export type JobRecord = {jobId: string; objectKey: string; generation: string; ownerSession: string;
  state: "ACTIVE" | "CANCELLED" | "COMPLETE"; wholeRestartCount: number; updatedAtMs: number};
export type Backing = {object: ObjectRecord; generation: GenerationRecord};
export interface DataStore {
  readonly backend: Backend;
  location(key: string, generation: string, index: number): string;
  read(receipt: BlockReceipt, complete: boolean): Promise<Uint8Array<ArrayBuffer>>;
  write(receipt: BlockReceipt, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  remove(key: string, generations: readonly string[]): Promise<void>;
  file?(key: string, generation: string): Promise<File>;
}
