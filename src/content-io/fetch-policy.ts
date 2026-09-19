import type {ContentDiagnostic} from "./session-diagnostics.js";
import type {ContentFetchPolicyV1} from "../../contracts/content-io/v1/content-io.js";
import {fail} from "./errors.js";
import {BLOCK_BYTES, integer, record} from "./source.js";

export const TEMPORARY_BYTES = 8 * 1024 * 1024;
export const CACHE_WRITE_BYTES = 2 * BLOCK_BYTES;
export const OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_FETCH_BYTES = (TEMPORARY_BYTES - OUTPUT_BYTES) / 2;
export type FetchPolicy = ContentFetchPolicyV1;
export type ContentSessionOptions = Readonly<{fetchPolicy?: Partial<FetchPolicy>; onDiagnostic?: (diagnostic: ContentDiagnostic) => void}>;
export const DEFAULT_FETCH_POLICY: FetchPolicy = Object.freeze({
  smallFileThresholdBytes: 1024 * 1024, networkWindowBytes: 512 * 1024,
});

export function validateFetchPolicy(value: unknown = {}): FetchPolicy {
  if (!record(value) || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_FETCH_POLICY, key))) {fail("SOURCE_INVALID");}
  const smallFileThresholdBytes = Object.hasOwn(value, "smallFileThresholdBytes") ? value.smallFileThresholdBytes : DEFAULT_FETCH_POLICY.smallFileThresholdBytes;
  const networkWindowBytes = Object.hasOwn(value, "networkWindowBytes") ? value.networkWindowBytes : DEFAULT_FETCH_POLICY.networkWindowBytes;
  if (!integer(smallFileThresholdBytes, 0, MAX_FETCH_BYTES) || !integer(networkWindowBytes, BLOCK_BYTES, MAX_FETCH_BYTES) ||
    networkWindowBytes % BLOCK_BYTES !== 0) {fail("SOURCE_INVALID");}
  return Object.freeze({smallFileThresholdBytes, networkWindowBytes});
}

export type FetchWindow = Readonly<{start: number; length: number; firstBlock: number; blockCount: number; wholeFile: boolean}>;
export function fetchWindow(sizeBytes: number, blockIndex: number, policy: FetchPolicy): FetchWindow {
  if (!integer(sizeBytes, 1) || !integer(blockIndex) || blockIndex > Math.floor((sizeBytes - 1) / BLOCK_BYTES)) {fail("BOUNDS");}
  const wholeFile = sizeBytes <= policy.smallFileThresholdBytes;
  const start = wholeFile ? 0 : Math.floor(blockIndex * BLOCK_BYTES / policy.networkWindowBytes) * policy.networkWindowBytes;
  const length = Math.min(wholeFile ? sizeBytes : policy.networkWindowBytes, sizeBytes - start);
  return {start, length, firstBlock: start / BLOCK_BYTES, blockCount: Math.ceil(length / BLOCK_BYTES), wholeFile};
}

export type MissingRange = Readonly<{start: number; length: number}>;
export function missingRanges(window: FetchWindow, present: ReadonlySet<number>): MissingRange[] {
  const result: {start: number; length: number}[] = [];
  for (let relative = 0; relative < window.blockCount; relative++) {
    const index = window.firstBlock + relative;
    if (present.has(index)) {continue;}
    const start = index * BLOCK_BYTES, length = Math.min(BLOCK_BYTES, window.length - relative * BLOCK_BYTES);
    const previous = result.at(-1);
    if (previous && previous.start + previous.length === start) {previous.length += length;}
    else {result.push({start, length});}
  }
  return result;
}
