import {afterEach, expect, it, vi} from "vitest";
import {createOnsProjectFileMap} from "../../src/ons/project-files.js";
import {contentSessionFixture} from "../content-session-fixture.js";
const owners: ReturnType<typeof contentSessionFixture>[]=[];
afterEach(async()=>{await Promise.all(owners.splice(0).map(owner=>owner.close()));vi.unstubAllGlobals();});
function fixture() {
 const owner=contentSessionFixture(location.origin);owners.push(owner);const progress=vi.fn(),failed=vi.fn();
 const fetcher=vi.fn(async(url:string)=>{const response=new Response(new Uint8Array([1,2,3]),{headers:{ETag:'"index-v1"'}});Object.defineProperty(response,"url",{value:url});return response;});vi.stubGlobal("fetch",fetcher);
 const files=[{path:"arc.nsa",sizeBytes:3,url:new URL("/arc",location.href).href},{path:"later.png",sizeBytes:3,url:new URL("/later",location.href).href}];
 const project=createOnsProjectFileMap(files,window,progress,{contentSession:owner.session,projectDigest:"a".repeat(64),onFailure:failed});
 return {owner,progress,failed,fetcher,project};
}
it("[IO-01] UNIT/ons map creation is metadata-only; one native open deduplicates and never reports total-project download progress",async()=>{
 const f=fixture(),writeFile=vi.fn();expect(f.fetcher).not.toHaveBeenCalled();expect(f.owner.files.size).toBe(0);
 const materialize=vi.spyOn(f.owner.session,"materialize");
 expect(await Promise.all([f.project.fetchFile({writeFile},"/game/arc.nsa"),f.project.fetchFile({writeFile},"/GAME/ARC.NSA")])).toEqual([1,1]);
 expect(writeFile).toHaveBeenCalledOnce();expect(materialize).toHaveBeenCalledOnce();expect(f.progress).not.toHaveBeenCalled();
 expect(f.fetcher.mock.calls.map(([url])=>url)).not.toContain(new URL("/later",location.href).href);await f.project.close();
 expect(await f.project.fetchFile({writeFile},"/game/arc.nsa")).toBe(-1);
});
it("[BR-08] UNIT/ons close during materialization prevents a late native FS write",async()=>{
 const f=fixture();let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
 const original=f.owner.session.materialize.bind(f.owner.session);
 vi.spyOn(f.owner.session,"materialize").mockImplementation(async(...args)=>{const result=await original(...args);await wait;return result;});
 const writeFile=vi.fn(),pending=f.project.fetchFile({writeFile},"/game/arc.nsa");
 await vi.waitFor(()=>expect(f.fetcher).toHaveBeenCalledOnce());const closing=f.project.close();release();await closing;
 expect(await pending).toBe(-1);expect(writeFile).not.toHaveBeenCalled();
});
