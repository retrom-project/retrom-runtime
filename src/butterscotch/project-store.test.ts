import {afterEach,expect,it,vi} from "vitest";
import {prepareButterscotchProject} from "./project-store.js";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
import {BLOCK_BYTES} from "../content-io/source.js";

const config={contentDigest:"b".repeat(64),sessionId:"launch-one",projectIndexUrl:location.origin+"/index.json"};
const size=8*1024*1024;
const index={schemaVersion:1,files:[{path:"Data.win",sizeBytes:size,url:"/data.win"},
  {path:"audio/unused.ogg",sizeBytes:size,url:"/unused.ogg"}]};
const owners:ReturnType<typeof contentSessionFixture>[]=[];
const projects:Awaited<ReturnType<typeof prepareButterscotchProject>>[]=[];
afterEach(async()=>{projects.splice(0).forEach(p=>p.release());await Promise.all(owners.splice(0).map(o=>o.close()));vi.restoreAllMocks();vi.unstubAllGlobals();});
function response(url:string,body:Uint8Array<ArrayBuffer>,init:ResponseInit){const result=new Response(body,init);Object.defineProperty(result,"url",{value:url});return result;}
function realm(){return {document:{baseURI:location.href},navigator:{storage:{getDirectory:async()=>{throw Error("denied");}}}} as unknown as Window;}
async function prepare(onFailure=vi.fn()){
 const owner=contentSessionFixture(location.origin,[location.origin],"butterscotch-gamemaker");owners.push(owner);
 const project=await prepareButterscotchProject(config,realm(),vi.fn(),{contentSession:owner.session,assetIndex:{},onFailure});projects.push(project);
 const buffer=new SharedArrayBuffer(64+BLOCK_BYTES),control=new Int32Array(buffer,0,16);control[1]=1;
 project.connect(buffer,0);return {project,control,buffer,owner,onFailure};
}
function request(control:Int32Array,id:number,offset:number,length:number){
 Atomics.add(control,2,1);Atomics.store(control,9,id);Atomics.store(control,10,offset);Atomics.store(control,7,length);
 Atomics.store(control,0,1);Atomics.notify(control,0);
}
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
 project.release();expect(Atomics.load(control,0)).toBe(4);
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
 await vi.waitFor(()=>expect(signal).toBeDefined());project.release();
 expect(Atomics.load(control,0)).toBe(4);await vi.waitFor(()=>expect(signal?.aborted).toBe(true));expect(onFailure).not.toHaveBeenCalled();
});
it("rejects out-of-bounds native reads without opening a source",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json(index)));
 const {control,onFailure,owner}=await prepare();request(control,0,size-4,16);
 await vi.waitFor(()=>expect(onFailure).toHaveBeenCalledOnce());expect(owner.files.size).toBe(0);
});
