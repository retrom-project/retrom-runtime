import type {AssetIndexV1} from "../provider/module-api.js";
import {checkSignal} from "./abort.js";
import {createContentHasher} from "./bounded-stream.js";
import {ContentSessionClient} from "./client.js";
import {ContentIOError, fail} from "./errors.js";
import {fetchWholeStream} from "./http.js";
import {validateFetchPolicy, type ContentSessionOptions} from "./fetch-policy.js";
import {isDigest, integer, type SourceContext} from "./source.js";
const prefix = "assets/content-io/";
/** Only fixed Provider assets, never a game-provided URL or an unverified second fetch. */
export async function verifiedContentAsset(baseURL: string, index: AssetIndexV1, name: "worker.mjs" | "sync-client.mjs", signal?: AbortSignal): Promise<Blob> {
  const path = prefix + name, identity = index[path];
  if (!identity || !integer(identity.sizeBytes, 1, 8 * 1024 * 1024) || !isDigest(identity.sha256)) {fail("SOURCE_INVALID");}
  const url = new URL(path, baseURL).href;
  const source = {identity: {kind: "FILE_SHA256", sha256: identity.sha256}, sizeBytes: identity.sizeBytes, url,
    purpose: "CORE_ASSET", transport: "WHOLE_ALLOWED", etagPolicy: "NONE_FULL_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
  const chunks: BlobPart[] = [], hash = createContentHasher();
  try {
    for await (const chunk of fetchWholeStream(source, {pinnedEtag: null, generation: crypto.randomUUID(), revoked: false}, signal)) {
      hash.update(chunk); chunks.push(chunk);
    }
    checkSignal(signal);
    if (hash.digest() !== identity.sha256) {fail("CHECKSUM_MISMATCH");}
    return new Blob(chunks, {type: "text/javascript"});
  } finally {hash.destroy();}
}
export async function bootstrapContentSession(options: SourceContext & ContentSessionOptions & {runtimeBaseURL: string; assetIndex: AssetIndexV1; signal?: AbortSignal; onFailure?: (error: ContentIOError) => void}): Promise<ContentSessionClient> {
  const fetchPolicy = validateFetchPolicy(options.fetchPolicy);
  const blob = await verifiedContentAsset(options.runtimeBaseURL, options.assetIndex, "worker.mjs", options.signal);
  checkSignal(options.signal);
  const url = URL.createObjectURL(blob);
  let worker: Worker | undefined, session: ContentSessionClient | undefined;
  let aborted = false;
  const abort = () => {
    if (aborted) {return;} aborted = true;
    if (session) {session.fail(new ContentIOError("ABORTED"));} else {worker?.terminate();}
  };
  options.signal?.addEventListener("abort", abort, {once: true});
  try {
    worker = new Worker(url, {type: "module", name: "retrom-content-io-v1"});
    session = new ContentSessionClient(worker, options, options.onFailure, {fetchPolicy, onDiagnostic: options.onDiagnostic}); await session.ready; checkSignal(options.signal); return session;
  } catch (error) {abort(); throw error;}
  finally {options.signal?.removeEventListener("abort", abort); URL.revokeObjectURL(url);}
}
