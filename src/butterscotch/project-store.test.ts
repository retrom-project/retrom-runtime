import {afterEach,expect,it,vi} from "vitest";
import {prepareButterscotchProject} from "./project-store.js";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
import {BLOCK_BYTES} from "../content-io/source.js";
import {LazyContentReader} from "../provider/lazy-reader.js";
import {ContentIOError} from "../content-io/errors.js";
import {deferred} from "../../tests/provider-adapter-fixture.js";

const config={contentDigest:"b".repeat(64),sessionId:"launch-one",projectIndexUrl:location.origin+"/index.json"};
const size=8*1024*1024;
const index={schemaVersion:1,files:[{path:"Data.win",sizeBytes:size,url:"/data.win"},
  {path:"audio/unused.ogg",sizeBytes:size,url:"/unused.ogg"}]};
const owners:ReturnType<typeof contentSessionFixture>[]=[];
const projects:Awaited<ReturnType<typeof prepareButterscotchProject>>[]=[];
afterEach(async()=>{await Promise.allSettled(projects.splice(0).map(p=>p.release()));await Promise.all(owners.splice(0).map(o=>o.close()));vi.restoreAllMocks();vi.unstubAllGlobals();});
function response(url:string,body:Uint8Array<ArrayBuffer>,init:ResponseInit){const result=new Response(body,init);Object.defineProperty(result,"url",{value:url});return result;}
function realm(){return {document:{baseURI:location.href},navigator:{storage:{getDirectory:async()=>{throw Error("denied");}}}} as unknown as Window;}
async function prepare(onFailure=vi.fn(),signal?:AbortSignal){
 const owner=contentSessionFixture(location.origin,[location.origin],"butterscotch-gamemaker");owners.push(owner);
 const project=await prepareButterscotchProject(config,realm(),vi.fn(),{contentSession:owner.session,assetIndex:{},onFailure,signal});projects.push(project);
 const buffer=new SharedArrayBuffer(64+BLOCK_BYTES),control=new Int32Array(buffer,0,16);control[1]=1;
 project.connect(buffer,0);return {project,control,buffer,owner,onFailure};
}
function request(control:Int32Array,id:number,offset:number,length:number){
 Atomics.add(control,2,1);Atomics.store(control,9,id);Atomics.store(control,10,offset);Atomics.store(control,7,length);
 Atomics.store(control,0,1);Atomics.notify(control,0);
}
it("release waits for every reader close and reuses the same completion promise",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json(index)));
 const first=deferred<void>(),second=deferred<void>();
 const close=vi.spyOn(LazyContentReader.prototype,"close").mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
 const {project,control}=await prepare();
 try {
  const closing=project.release();
  expect(closing).toBeInstanceOf(Promise);expect(project.release()).toBe(closing);
  expect(Atomics.load(control,0)).toBe(4);expect(close).toHaveBeenCalledTimes(2);
  let finished=false;void Promise.resolve(closing).then(()=>{finished=true;});
  first.resolve();await Promise.resolve();expect(finished).toBe(false);
  second.resolve();await closing;expect(finished).toBe(true);
 } finally {first.resolve();second.resolve();}
});
it("retains an unexpected close failure after every reader has settled",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json(index)));
 const first=deferred<void>(),second=deferred<void>();
 vi.spyOn(LazyContentReader.prototype,"close").mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
 const {project}=await prepare();
 let finished=false;
 const closing=project.release();void closing.then(()=>{finished=true;},()=>{finished=true;});
 const rejected=expect(closing).rejects.toThrow("CONTENT_IO_INTERNAL");
 first.reject(new ContentIOError("INTERNAL"));await Promise.resolve();expect(finished).toBe(false);
 second.resolve();await rejected;
});
it.each(["ABORTED","INTERNAL"] as const)("handles %s during host abort without a detached rejection",async code=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json(index)));
 const pending=deferred<void>(),abort=new AbortController(),onFailure=vi.fn();
 vi.spyOn(LazyContentReader.prototype,"close").mockReturnValue(pending.promise);
 const {project,control}=await prepare(onFailure,abort.signal);
 abort.abort();expect(Atomics.load(control,0)).toBe(4);
 const closing=project.release(),error=new ContentIOError(code);
 const checked=code==="ABORTED"?expect(closing).resolves.toBeUndefined():expect(closing).rejects.toBe(error);
 pending.reject(error);await checked;
 if(code==="ABORTED"){expect(onFailure).not.toHaveBeenCalled();}else{expect(onFailure).toHaveBeenCalledExactlyOnceWith(error);}
});
it("registers metadata without content downloads or mandatory OPFS, then reads only requested ranges",async()=>{
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith("index.json")){return Response.json(index);}
  expect(String(input)).toBe(location.origin+"/data.win");
  const range=new Headers(init?.headers).get("Range")!;
  const [,start,end]=/^bytes=(\d+)-(\d+)$/u.exec(range)!;
  const bytes=new Uint8Array(Number(end)-Number(start)+1).fill(37);
  return response(String(input),bytes,{status:206,headers:{ETag:'"stable"',"Content-Range":`bytes ${start}-${end}/${size}`,"Content-Length":String(bytes.length)}});
 });vi.stubGlobal("fetch",fetcher);
 const {project,control,buffer,owner,onFailure}=await prepare();
 expect(fetcher).toHaveBeenCalledTimes(1);expect(owner.files.size).toBe(0);
 expect(project.gamePath).toBe("/content/Data.win");expect(project.savePath).toBe("/saves/launch-one");
 expect(project.files).toEqual([{id:0,path:"/content/Data.win",sizeBytes:size},{id:1,path:"/content/audio/unused.ogg",sizeBytes:size}]);
 request(control,0,1024,32);await vi.waitFor(()=>{expect(onFailure.mock.calls).toEqual([]);expect(Atomics.load(control,0)).toBe(2);});
 expect([...new Uint8Array(buffer,64,32)]).toEqual(Array(32).fill(37));
 expect(owner.store.stats).toMatchObject({networkBytes:262144,rangeRequests:1,wholeRequests:0});
 expect(owner.files.size).toBe(1);
 Atomics.store(control,0,0);Atomics.notify(control,0);
 request(control,0,2048,16);await vi.waitFor(()=>expect(Atomics.load(control,0)).toBe(2));
 expect(fetcher).toHaveBeenCalledTimes(2);
 await project.release();expect(Atomics.load(control,0)).toBe(4);
});
it("rejects a large-file full response rather than silently downloading the project",async()=>{
 vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith("index.json")?Response.json(index):response(String(input),new Uint8Array(size),{headers:{ETag:'"stable"'}})));
 const {control,onFailure}=await prepare();request(control,0,0,16);
 await vi.waitFor(()=>expect(onFailure).toHaveBeenCalledOnce());expect(Atomics.load(control,0)).toBe(4);expect(onFailure.mock.calls[0][0].message).toBe("CONTENT_IO_RANGE_UNSUPPORTED");
});
it("release cancels an in-flight read and wakes the native thread without reporting a game failure",async()=>{
 let signal:AbortSignal|null|undefined;
 vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith("index.json")){return Response.json(index);}signal=init?.signal;
  return await new Promise<Response>((_,reject)=>signal?.addEventListener("abort",()=>reject(signal!.reason),{once:true}));
 }));
 const {project,control,onFailure}=await prepare();request(control,0,0,16);
 await vi.waitFor(()=>expect(signal).toBeDefined());await project.release();
 expect(Atomics.load(control,0)).toBe(4);await vi.waitFor(()=>expect(signal?.aborted).toBe(true));expect(onFailure).not.toHaveBeenCalled();
});
it("rejects out-of-bounds native reads without opening a source",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json(index)));
 const {control,onFailure,owner}=await prepare();request(control,0,size-4,16);
 await vi.waitFor(()=>expect(onFailure).toHaveBeenCalledOnce());expect(owner.files.size).toBe(0);
});
