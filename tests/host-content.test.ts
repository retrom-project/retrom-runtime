import {afterEach, expect, test} from "vitest";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openContent, readContent, contentStream} from "../scripts/runtime-host-content.mjs";

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});

test("logical reads, size and streams never expose adjacent package members", async () => {
  const root = await mkdtemp(join(tmpdir(), "content-interval-")); roots.push(root);
  const path = join(root, "package"); await writeFile(path, "beforePAYLOADafter");
  const locator = {path, offset: 6, sizeBytes: 7};
  expect((await readContent(locator)).toString()).toBe("PAYLOAD");
  const handle = await openContent(locator);
  try {
    expect((await handle.stat()).size).toBe(7);
    const buffer = Buffer.alloc(20);
    expect((await handle.read(buffer, 0, 20, 5)).bytesRead).toBe(2);
    expect(buffer.subarray(0, 2).toString()).toBe("AD");
    await expect(handle.read(buffer, 0, 1, -1)).rejects.toThrow();
  } finally {await handle.close();}
  const chunks = []; for await (const chunk of contentStream(locator, {start: 3, length: 4})) {chunks.push(chunk);}
  expect(Buffer.concat(chunks).toString()).toBe("LOAD");
  await expect(openContent({...locator, sizeBytes: 100})).rejects.toThrow();
  await expect(openContent({...locator, offset: Number.MAX_SAFE_INTEGER})).rejects.toThrow();
  const empty = []; for await (const chunk of contentStream({...locator, sizeBytes: 0})) {empty.push(chunk);}
  expect(empty).toEqual([]);
});
