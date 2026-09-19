import {expect, it} from "vitest";
import {contentLimits} from "./limits.js";
import {validateSourcePolicy} from "./policy.js";
import type {ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";
import {eagerPolicy} from "../provider/content-policies.js";
const expected = {
  signedDisc: 2147483647, np2kaiDisk: 536870912, firmwareFile: 67108864,
  gbeRom: 2097152, openborPak: 536870912, webmsxMedia: 16777216,
  ruffleSwf: 67108864, fantasyFile: 8388608, wasm4Cart: 65536,
  nxengineFile: 33554432, pspAsset: 134217728, indexedFile: Number.MAX_SAFE_INTEGER,
};
it("[ST-15] UNIT/declared-limits keeps every existing adapter byte limit", () => {
  expect(contentLimits).toEqual(expected); expect(Object.isFrozen(contentLimits)).toBe(true);
});
it.each(Object.entries(expected))("[ST-15] UNIT/max-%s accepts exactly max and rejects max+1 before consumption", (_name, limit) => {
  const source: ContentSourceV1 = {identity: {kind: "FILE_SHA256", sha256: "1".repeat(64)}, sizeBytes: limit,
    url: "https://example.test/game", purpose: "GAME", transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"};
  expect(() => validateSourcePolicy(source, eagerPolicy(limit))).not.toThrow();
  expect(() => validateSourcePolicy({...source, sizeBytes: limit + 1}, eagerPolicy(limit))).toThrow("SOURCE_INVALID");
});
