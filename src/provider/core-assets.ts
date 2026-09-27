import {ContentIOError} from "../content-io/errors.js";
import {canonicalPath} from "../content-io/source.js";
import {materializeFileBytes, type AdapterContentOptions} from "./content-inputs.js";
import {eagerPolicy} from "./content-policies.js";
import type {PreparationProgress} from "../content-io/progress.js";

/** Asset identity comes exclusively from the verified Provider bundle. */
export function loadCoreAsset(content: AdapterContentOptions, runtimeBaseURL: string, path: string,
  maximum: number, signal?: AbortSignal, report?: (progress: PreparationProgress) => void) {
  const identity = content.assetIndex[path];
  if (!canonicalPath(path) || !identity || identity.sizeBytes < 1 || identity.sizeBytes > maximum) {
    throw new ContentIOError("SOURCE_INVALID");
  }
  const base = new URL(runtimeBaseURL, location.href);
  return materializeFileBytes(content.contentSession, {...identity, url: new URL(path, base).href},
    eagerPolicy(maximum), "CORE_ASSET", signal, report);
}
