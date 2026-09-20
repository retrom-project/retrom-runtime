import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {contentSessionFixture} from "../content-session-fixture.js";
import {verifiedFetch} from "../../src/fantasy-console/fetch.js";
import {fetchFile as gbe} from "../../src/gbe-pokemini/files.js";
import {fetchFile as px68k} from "../../src/px68k/files.js";
import {loadDisk} from "../../src/np2kai/content.js";
import {fetchPak} from "../../src/openbor/fetch.js";
import {fetchSwf} from "../../src/ruffle/fetch.js";
import {fetchMedia} from "../../src/webmsx/fetch.js";
import type {AdapterContentSession} from "../../src/provider/content-inputs.js";
type Source = {url: string; sizeBytes: number; sha256: string};
const owners: ReturnType<typeof contentSessionFixture>[] = [];
afterEach(async () => {await Promise.all(owners.splice(0).map(owner => owner.close())); vi.unstubAllGlobals();});
const cases: {name: string; load(source: Source, session: AdapterContentSession, progress: (loaded: number) => void): Promise<Uint8Array>}[] = [
  {name: "fantasy", load: (f,s) => verifiedFetch(f.url,f.sizeBytes,f.sha256,undefined,s)},
  {name: "gbe", load: (f,s,p) => gbe(f,p,undefined,s)},
  {name: "px68k", load: (f,s,p) => px68k(f,p,undefined,s)},
  {name: "np2kai", load: (f,s,p) => loadDisk(f,v=>p(v.loadedBytes),s)},
  {name: "openbor", load: (f,s,p) => fetchPak(f,v=>p(v.loadedBytes),s)},
  {name: "ruffle", load: (f,s,p) => fetchSwf({swfUrl:f.url,swfSizeBytes:f.sizeBytes,contentDigest:f.sha256},v=>p(v.loadedBytes),s)},
  {name: "webmsx", load: (f,s,p) => fetchMedia({mediaUrl:f.url,mediaSizeBytes:f.sizeBytes,contentDigest:f.sha256},v=>p(v.loadedBytes),s)},
];
it.each(cases)("[X-26] UNIT/eager-$name preserves roles, verifies before completion and returns isolated output", async entry => {
  const bytes = new Uint8Array(16); bytes.set(entry.name === "ruffle" ? [70,87,83,9,16,0,0,0] : [80,65,67,75]);
  const source = {url: "http://localhost/game", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
  const owner = contentSessionFixture("http://localhost"); owners.push(owner);
  const fetcher = vi.fn(async (url: string) => {const r = new Response(bytes,{headers:{ETag:`"sha256-${source.sha256}"`}});Object.defineProperty(r,"url",{value:url});return r;});
  vi.stubGlobal("fetch",fetcher);
  const spy = vi.spyOn(owner.session,"materialize"), progress=vi.fn();
  const result = await entry.load(source,owner.session,progress);expect(result).toEqual(bytes);expect(spy).toHaveBeenCalledOnce();
  expect(owner.files.size).toBe(0);result.fill(1);expect(bytes[0]).not.toBe(1);
});
it.each(cases)("[X-26] UNIT/eager-$name corrupt bytes cannot report completion",async entry=>{
  const source={url:"http://localhost/game",sizeBytes:16,sha256:"a".repeat(64)},owner=contentSessionFixture("http://localhost");owners.push(owner);
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{const r=new Response(new Uint8Array(16),{headers:{ETag:`"sha256-${source.sha256}"`}});Object.defineProperty(r,"url",{value:url});return r;}));
  const progress=vi.fn();await expect(entry.load(source,owner.session,progress)).rejects.toThrow("CHECKSUM_MISMATCH");
  expect(progress.mock.calls.some(([value])=>value===source.sizeBytes)).toBe(false);expect(owner.files.size).toBe(0);
});
