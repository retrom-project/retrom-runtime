// @vitest-environment node
import {expect, it} from "vitest";
import {contentObjectKey, validateSource} from "../source.js";
it("[ST-17] UNIT/cache-identity separates storage/source origins, purpose, project, path and size while ignoring signed URL changes", () => {
  const context = {storageOrigin: "https://host.test", allowedOrigins: ["https://content.test", "https://other.test"]};
  const input = {identity: {kind: "INDEX_ENTRY", projectDigest: "a".repeat(64), logicalPath: "Data/game.bin"},
    sizeBytes: 100, url: "https://content.test/game?token=one", purpose: "GAME", transport: "RANGE_REQUIRED",
    etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
  const key = (value: unknown, origin = context.storageOrigin) => contentObjectKey(validateSource(value, context), origin);
  const original = key(input);
  expect(key({...input, url: "https://content.test/different-route?token=two"})).toBe(original);
  expect(key(input, "https://another-host.test")).not.toBe(original);
  for (const change of [{url: "https://other.test/game"}, {sizeBytes: 101}, {purpose: "FIRMWARE"},
    {identity: {...input.identity, projectDigest: "b".repeat(64)}}, {identity: {...input.identity, logicalPath: "Data/other.bin"}}]) {
    expect(key({...input, ...change})).not.toBe(original);
  }
  expect(() => validateSource({...input, url: "https://unapproved.test/game"}, context)).toThrow("SOURCE_INVALID");
});
