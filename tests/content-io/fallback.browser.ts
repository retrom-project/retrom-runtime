import type {ContentDiagnostic} from "../../src/content-io/session-diagnostics.js";
import {test,expect} from "@playwright/test";
import {build} from "esbuild";
import {startFixtureServer} from "./fixture-server.mjs";
const compile=async(contents:string)=>(await build({stdin:{contents,resolveDir:process.cwd()},bundle:true,format:"esm",platform:"browser",write:false,target:"es2022"})).outputFiles[0].text;
for(const scenario of ["readable-prefix","missing-prefix","whole-restart"]){
 test(`[ST-14] BROWSER/${scenario} preserves content across a real OPFS failure @S07`,async({page})=>{
  const worker=await compile(`import {OPFSStore} from './src/content-io/store/opfs.ts';import './tests/content-io/trace-worker.ts';
   const write=OPFSStore.prototype.write,read=OPFSStore.prototype.read;let failed=false;
   OPFSStore.prototype.write=async function(receipt,bytes){if(receipt.index>=1){failed=true;throw new DOMException('quota','QuotaExceededError');}return write.call(this,receipt,bytes);};
   OPFSStore.prototype.read=async function(...args){if(failed&&${JSON.stringify(scenario!=="readable-prefix")}){throw new Error('lost prefix');}return read.apply(this,args);};`);
  const server=await startFixtureServer({contentModule:await compile("export {createContentSession} from './src/content-io/client.ts'; export {workerStats} from './tests/content-io/worker-stats.ts';"),modules:{"worker.mjs":worker}});
  const identity=server.register({id:"blob",fixtureId:"multi-tail",behavior:scenario==="whole-restart"?"IGNORE_RANGE":"NORMAL",seed:17,delayBeforeHeadersMs:null,chunkDelayMs:20,disconnectAfterBytes:null,barrier:null});
  try{
   await page.goto(`${server.origin}/__test__/page`);
   const result=await page.evaluate(async({identity})=>{
    const url="/__test__/content.mjs",{createContentSession,workerStats}=await import(url) as typeof import("../../src/content-io/client.js") & typeof import("./worker-stats.js");
    const worker = new Worker("/__test__/worker.mjs", {type: "module"});
    const diagnostics: ContentDiagnostic[] = [];
    const session=await createContentSession(worker,{storageOrigin:location.origin,allowedOrigins:[location.origin]}, {onDiagnostic: value => diagnostics.push(value), fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
    try{
     const reader=await session.open({identity:identity.identity,sizeBytes:identity.sizeBytes,url:`${location.origin}/objects/multi-tail/blob`,purpose:"GAME",transport:"WHOLE_ALLOWED",etagPolicy:"EXPECTED_SHA256",contentLengthPolicy:"EXACT_IF_PRESENT",},
      {mode:"EAGER",bridge:"NONE",result:"BLOB",maxFileBytes:identity.sizeBytes,workspace:"NONE",writes:"DENY",contentLengthPolicy:"EXACT_IF_PRESENT",});
     const progress:{readyBytes:number;networkBytes:number;attempt:number}[]=[];
     const value=await session.materialize(reader.id,{kind:"BLOB",maxBytes:identity.sizeBytes},undefined,p=>progress.push(p));if(value.kind!=="BLOB"){throw new Error("kind");}
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await value.blob.arrayBuffer())),n=>n.toString(16).padStart(2,"0")).join("");
     await value.release();
     const stats = await workerStats(worker);
     const held = (await navigator.locks.query()).held?.filter(lock => lock.name?.startsWith("retrom-content-io-v1:use:")).length ?? 0;
     await reader.close();
     return {hash, progress, diagnostics, backend: session.stats.backend, stats, held, closed: await workerStats(worker)};
    }finally{await session.close();}
   },{identity});
   expect(result.hash).toBe(identity.identity.kind==="FILE_SHA256"?identity.identity.sha256:"");
   expect(result.stats.leases).toBe(result.held); expect(result.closed.leases).toBe(0);
   expect(result.diagnostics.filter(value => value.codeNumber !== 0).map(value => value.counts.cacheDegrades)).toEqual([1]);
   expect(result.stats.cacheDegrades).toBe(1); expect(result.stats.corruptBlocks).toBe(0);
   expect(result.stats.materialization.wholeRestartCount).toBe(scenario === "whole-restart" ? 1 : 0);
   expect(result.stats.materialization.materializedBytesByKind).toEqual({BYTES: 0, BLOB: identity.sizeBytes, SINK: 0});
   const requests=server.requests("blob");expect(requests.filter(r=>r.range===null)).toHaveLength(scenario==="whole-restart"?2:1);
   if(scenario==="readable-prefix"){expect(requests).toHaveLength(1);}else{expect(result.backend).toBe("CACHE_BLOCKS");expect(requests.some(r=>r.range!==null)).toBe(true);}
   expect(result.progress.at(-1)?.attempt).toBe(scenario==="whole-restart"?1:0);
   for(let i=1;i<result.progress.length;i++){const previous=result.progress[i-1],current=result.progress[i];expect(current.networkBytes).toBeGreaterThanOrEqual(previous.networkBytes);if(current.attempt===previous.attempt){expect(current.readyBytes).toBeGreaterThanOrEqual(previous.readyBytes);}}
  }finally{await server.close();}
 });
}
