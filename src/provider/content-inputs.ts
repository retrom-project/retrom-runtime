import type {ContentSourceV1, ManagedInputPolicyV1} from "../../contracts/content-io/v1/content-io.js";
import type {ContentSessionClient} from "../content-io/client.js";
import {ContentIOError} from "../content-io/errors.js";
/** Only the Provider/adapter management path converts authorized resources into sources. */
export function fileContentSource(file: {url: string; sha256: string; sizeBytes: number}, policy: ManagedInputPolicyV1,
  purpose: ContentSourceV1["purpose"] = "GAME"): ContentSourceV1 {
  return {identity: {kind: "FILE_SHA256", sha256: file.sha256}, sizeBytes: file.sizeBytes,
    url: new URL(file.url, globalThis.location?.href).href, purpose,
    transport: policy.mode === "RANGE" ? "RANGE_REQUIRED" : "WHOLE_ALLOWED",
    etagPolicy: policy.mode === "EAGER" ? "NONE_FULL_SHA256" : "EXPECTED_SHA256",
    contentLengthPolicy: policy.contentLengthPolicy, };
}
export function requireContentSession<T extends ContentSessionAccess>(session?: T | null): T {
  if (!session) {throw new ContentIOError("ABI_MISMATCH");} return session;
}

export type ContentSessionAccess = Pick<ContentSessionClient, "materialize" | "closeFile"> & {
  readonly preloaded?: boolean;
  open(source: ContentSourceV1, policy: ManagedInputPolicyV1, signal?: AbortSignal): Promise<import("../../contracts/content-io/v1/content-io.js").ContentReaderV1>;
};
export type AdapterContentSession = ContentSessionAccess & {
  inputPolicy(role: string, member?: string): ManagedInputPolicyV1;
};
export type AdapterContentOptions = {
  contentSession: AdapterContentSession;
  assetIndex: import("./module-api.js").AssetIndexV1;
  signal?: AbortSignal;
  reportProgress?: import("../internal-adapter.js").RuntimeProgressReporter;
  onFailure?: (error: Error) => void;
};
export async function materializeFileBytes(session: ContentSessionAccess, file: {url: string; sha256: string; sizeBytes: number},
  policy: ManagedInputPolicyV1, purpose: ContentSourceV1["purpose"], signal?: AbortSignal,
  report?: (value: import("../content-io/progress.js").PreparationProgress) => void): Promise<Uint8Array> {
  const reader = await session.open(fileContentSource(file, policy, purpose), policy, signal);
  try {
    const result = await session.materialize(reader.id, {kind: "BYTES", maxBytes: policy.maxFileBytes}, signal, report);
    if (result.kind !== "BYTES") {throw new ContentIOError("INTERNAL");} return result.bytes;
  } finally {await reader.close();}
}
