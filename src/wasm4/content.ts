import {materializeFileBytes, type AdapterContentOptions} from "../provider/content-inputs.js";
import {eagerPolicy} from "../provider/content-policies.js";
import {contentLimits} from "../content-io/limits.js";
import {ContentIOError} from "../content-io/errors.js";
import type {Wasm4Parameters} from "./parameters.js";
import type {RuntimeProgressReporter} from "../internal-adapter.js";
export async function fetchCart(config: Wasm4Parameters, report: RuntimeProgressReporter,
  content?: AdapterContentOptions & {signal?: AbortSignal}) {
  if (!content) {throw new ContentIOError("ABI_MISMATCH");}
  if (!Number.isSafeInteger(config.cartSizeBytes) || config.cartSizeBytes < 1 || config.cartSizeBytes > contentLimits.wasm4Cart) {
    throw new Error("WASM4_CART_SIZE_MISMATCH");
  }
  return materializeFileBytes(content.contentSession, {url: config.cartUrl, sizeBytes: config.cartSizeBytes, sha256: config.contentDigest},
    eagerPolicy(contentLimits.wasm4Cart), "GAME", content.signal,
    value => report({phase: "PROJECT_CONTENT", loadedBytes: value.readyBytes, totalBytes: config.cartSizeBytes}));
}
