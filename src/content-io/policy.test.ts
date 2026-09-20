import {expect, it} from "vitest";
import {validateManagedPolicy, validateContentPolicies} from "./policy.js";
const range = () => ({mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: 2147483647,
  workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", });
it("[X-30] CONTRACT/stage-S02 enforces managed policy combinations and role closure", () => {
  expect(validateManagedPolicy(range())).toEqual(range());
  for (const patch of [{bridge: "NONE"}, {result: "BYTES"}, {workspace: "OPFS_REQUIRED"}, {maxFileBytes: NaN}, {extra: 1}]) {
    expect(() => validateManagedPolicy({...range(), ...patch})).toThrow("CONTENT_IO_SOURCE_INVALID");
  }
  expect(() => validateContentPolicies(["game", "rtp"], {game: range()}, [])).toThrow();
  expect(() => validateContentPolicies(["game"], {game: {mode: "UPSTREAM_LOADER", boundaryId: "unregistered"}}, [])).toThrow();
  expect(() => validateContentPolicies(["game"], {game: {mode: "BROWSER_NATIVE", boundaryId: "native-web"}}, ["native-web"])).not.toThrow();
});
