// @vitest-environment node
import {describe, expect, it} from "vitest";
import {contentObjectKey, validateReadBounds, validateSource} from "./source.js";
const digest = "a".repeat(64);
const context = {storageOrigin: "https://example.test", allowedOrigins: ["https://example.test"]};
const input = () => ({identity: {kind: "FILE_SHA256", sha256: digest}, sizeBytes: 786449,
  url: "https://example.test/game", purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "EXPECTED_SHA256",
  contentLengthPolicy: "EXACT_IF_PRESENT", });

describe("content source contract", () => {
  it("[IO-01] CONTRACT/registration freezes a validated copy without network", () => {
    const raw = input(), source = validateSource(raw, context);
    raw.identity.sha256 = "b".repeat(64); raw.url = "https://example.test/changed";
    expect(source.identity).toEqual({kind: "FILE_SHA256", sha256: digest});
    expect(source.url).toBe("https://example.test/game"); expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.identity)).toBe(true);
  });
  it("[IO-03] CONTRACT/bounds-zero admits exact EOF but not positions beyond it", () => {
    expect(() => validateReadBounds(0, 0, 0)).not.toThrow();
    expect(() => validateReadBounds(2, 2, 0)).not.toThrow();
    expect(() => validateReadBounds(2, 3, 0)).toThrow("CONTENT_IO_BOUNDS");
  });
  it("[IO-04] CONTRACT/invalid-integers rejects malformed values before allocation", () => {
    for (const bad of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(() => validateSource({...input(), sizeBytes: bad}, context)).toThrow("CONTENT_IO_SOURCE_INVALID");
      expect(() => validateReadBounds(100, bad as number, 0)).toThrow("CONTENT_IO_BOUNDS");
      expect(() => validateReadBounds(100, 0, bad as number)).toThrow("CONTENT_IO_BOUNDS");
    }
    expect(() => validateReadBounds(16777217, 0, 16777217)).toThrow("CONTENT_IO_BOUNDS");
  });
  it("[IO-05] CONTRACT/large-offsets preserves all safe integer bits", () => {
    expect(() => validateReadBounds(5368709243, 4294967327, 4096)).not.toThrow();
    expect(() => validateReadBounds(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 16, 16)).not.toThrow();
    expect(() => validateReadBounds(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 16, 17)).toThrow();
  });
  it("[IO-21] CONTRACT/object-identity separates paths, purposes, origins and sizes; URL is not identity", () => {
    const source = validateSource(input(), context);
    const key = contentObjectKey(source, context.storageOrigin);
    expect(contentObjectKey(validateSource({...input(), url: "https://example.test/other"}, context), context.storageOrigin)).toBe(key);
    for (const patch of [{sizeBytes: 99}, {purpose: "FIRMWARE"},
      {identity: {kind: "INDEX_ENTRY", projectDigest: digest, logicalPath: "first"}, etagPolicy: "PIN_STRONG"}]) {
      expect(contentObjectKey(validateSource({...input(), ...patch}, context), context.storageOrigin)).not.toBe(key);
    }
    const entry = (logicalPath: string) => validateSource({...input(), identity: {kind: "INDEX_ENTRY", projectDigest: digest, logicalPath}, etagPolicy: "PIN_STRONG"}, context);
    expect(contentObjectKey(entry("first"), context.storageOrigin)).not.toBe(contentObjectKey(entry("second"), context.storageOrigin));
  });
  it.each(["https://elsewhere.test/game", "https://user@example.test/game", "https://example.test/game#x",
    "https://example.test\\game", "/relative", "data:text/plain,hello"])("rejects unapproved URL %s", (url) => {
    expect(() => validateSource({...input(), url}, context)).toThrow("CONTENT_IO_SOURCE_INVALID");
  });
  it("rejects extra fields and ambiguous identity profiles", () => {
    for (const patch of [{unknown: true}, {etagPolicy: "NONE_FULL_SHA256"},
      {identity: {kind: "FILE_SHA256", sha256: digest.toUpperCase()}},
      {identity: {kind: "INDEX_ENTRY", projectDigest: digest, logicalPath: "../game"}, etagPolicy: "PIN_STRONG"},
      {purpose: "CORE_ASSET", identity: {kind: "INDEX_ENTRY", projectDigest: digest, logicalPath: "data"}, etagPolicy: "PIN_STRONG"}]) {
      expect(() => validateSource({...input(), ...patch}, context)).toThrow("CONTENT_IO_SOURCE_INVALID");
    }
  });
});
