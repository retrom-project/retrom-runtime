import {afterEach, expect, it, vi} from "vitest";
import {createOnsProjectFileMap} from "../../src/ons/project-files.js";
import {contentSessionFixture} from "../content-session-fixture.js";
const archiveBytes = 4 * 1024 * 1024;
const archive = Uint8Array.from({length: archiveBytes}, (_, index) => (index * 31 + 7) & 255);
const owners: ReturnType<typeof contentSessionFixture>[] = [];
afterEach(async () => {await Promise.all(owners.splice(0).map(owner => owner.close())); vi.unstubAllGlobals();});
function rangeFetch(gate?: Promise<void>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    await gate;
    const header = new Headers(init?.headers).get("Range");
    const match = header ? /^bytes=(\d+)-(\d+)$/u.exec(header) : null;
    const start = match ? Number(match[1]) : 0, end = match ? Math.min(Number(match[2]), archiveBytes - 1) : archiveBytes - 1;
    const response = new Response(archive.slice(start, end + 1), {status: match ? 206 : 200, headers: {ETag: '"arc-v1"',
      "Content-Length": String(end - start + 1), ...(match ? {"Content-Range": `bytes ${start}-${end}/${archiveBytes}`} : {})}});
    Object.defineProperty(response, "url", {value: url});
    return response;
  });
}
function fixture(fetcher: ReturnType<typeof rangeFetch>) {
  const owner = contentSessionFixture(location.origin, undefined, "onscripter-yuri"); owners.push(owner);
  vi.stubGlobal("fetch", fetcher);
  const failed = vi.fn(), progress = vi.fn();
  const files = [{path: "arc.nsa", sizeBytes: archiveBytes, url: new URL("/arc", location.href).href}];
  const project = createOnsProjectFileMap(files, window, progress, {contentSession: owner.session, projectDigest: "a".repeat(64), onFailure: failed});
  return {owner, failed, progress, project};
}
const requested = (fetcher: ReturnType<typeof rangeFetch>) => fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get("Range"));

it("[IO-01] UNIT/ons reads an archive by byte range instead of materializing the whole file", async () => {
  const fetcher = rangeFetch(), f = fixture(fetcher);
  const materialize = vi.spyOn(f.owner.session, "materialize");
  const handle = await f.project.bridge.open("/GAME/ARC.NSA");
  expect(handle).toBeGreaterThan(0); expect(f.project.bridge.size(handle)).toBe(archiveBytes); expect(fetcher).not.toHaveBeenCalled();
  const offset = 3 * 1024 * 1024 + 123;
  expect(f.project.bridge.tryRead(handle, offset, 100)).toBeNull();
  expect(await f.project.bridge.read(handle, offset, 100)).toEqual(archive.slice(offset, offset + 100));
  const ranges = requested(fetcher);
  expect(ranges.length).toBeGreaterThan(0); expect(ranges.every(range => range !== null)).toBe(true);
  const fetchedBytes = ranges.reduce((sum, range) => {const [, start, end] = /(\d+)-(\d+)/u.exec(range!)!; return sum + Number(end) - Number(start) + 1;}, 0);
  expect(fetchedBytes).toBeLessThanOrEqual(1024 * 1024); expect(materialize).not.toHaveBeenCalled();
  // The same range is now local and is served synchronously without another request.
  const calls = fetcher.mock.calls.length;
  expect(f.project.bridge.tryRead(handle, offset, 100)).toEqual(archive.slice(offset, offset + 100));
  expect(fetcher.mock.calls.length).toBe(calls);
  expect(await f.project.bridge.read(handle, archiveBytes - 10, 100)).toEqual(archive.slice(archiveBytes - 10));
  expect(await f.project.bridge.open("/game/arc1.nsa")).toBe(0);
  expect(f.progress).not.toHaveBeenCalled(); expect(f.failed).not.toHaveBeenCalled();
  f.project.bridge.close(handle); await f.project.close();
  expect(await f.project.bridge.open("/game/arc.nsa")).toBe(-1);
});

it("[BR-08] UNIT/ons close during a pending range read returns no late bytes", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  const fetcher = rangeFetch(gate), f = fixture(fetcher);
  const handle = await f.project.bridge.open("/game/arc.nsa");
  const pending = f.project.bridge.read(handle, 2 * 1024 * 1024, 4096);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(f.project.hasPendingReads()).toBe(true);
  const closing = f.project.close(); release(); await closing;
  expect(await pending).toBeNull(); expect(f.project.hasPendingReads()).toBe(false);
});
