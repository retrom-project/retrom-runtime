// @vitest-environment node
import {expect, it} from "vitest";
import {syncRead, syncWrite, type SyncAccess} from "./opfs.js";
it("[ST-01] UNIT/short-io short reads and writes advance safe offsets above 4GiB", () => {
  const written: number[] = [], offsets: number[] = [];
  const access: SyncAccess = {write: (bytes, {at}) => {offsets.push(at); written.push(bytes[0]); return 1;},
    read: (bytes, {at}) => {bytes[0] = at - 4294967296 + 1; return 1;}, flush: () => {}, close: () => {}};
  syncWrite(access, new Uint8Array([1, 2, 3]), 4294967296);
  expect(written).toEqual([1, 2, 3]); expect(offsets).toEqual([4294967296, 4294967297, 4294967298]);
  const bytes = new Uint8Array(3); syncRead(access, bytes, 4294967296); expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(() => syncWrite({...access, write: () => 0}, bytes, 0)).toThrow("CACHE_UNAVAILABLE");
  expect(() => syncRead({...access, read: () => 0}, bytes, 0)).toThrow("CACHE_UNAVAILABLE");
});
