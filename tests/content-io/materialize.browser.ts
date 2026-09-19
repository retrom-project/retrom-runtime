import type {ContentDiagnostic} from "../../src/content-io/session-diagnostics.js";
import {test, expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle = async (name: string) => (await build({entryPoints: [fileURLToPath(new URL(`../../src/content-io/${name}.ts`, import.meta.url))],
  bundle: true, format: "esm", platform: "browser", write: false, target: "es2022"})).outputFiles[0].text;
test("[ST-10] BROWSER/whole-to-range [ST-11] BROWSER/whole [X-22] BROWSER/long-prepare [X-26] BROWSER/stream-commit @S07", async ({page}) => {
  const server = await startFixtureServer({contentModule: await bundle("client"), modules: {"worker.mjs": await bundle("worker")}});
  const identity = server.register({id: "game", fixtureId: "multi-tail", behavior: "NORMAL", seed: 17,
    delayBeforeHeadersMs: null, chunkDelayMs: null, disconnectAfterBytes: null, barrier: null});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async ({identity}) => {
      const moduleUrl = "/__test__/content.mjs";
      const {createContentSession} = await import(moduleUrl) as typeof import("../../src/content-io/client.js");
      const context = {storageOrigin: location.origin, allowedOrigins: [location.origin]};
      const source = {identity: identity.identity, sizeBytes: identity.sizeBytes, url: `${location.origin}/objects/multi-tail/game`, purpose: "GAME", transport: "WHOLE_ALLOWED",
        etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
      const policy = {mode: "EAGER", bridge: "NONE", result: "BYTES", maxFileBytes: Number.MAX_SAFE_INTEGER, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT", } as const;
      const hashes = [], backends = [];
      for (let i = 0; i < 2; i++) {
        const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), context, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
        try {
          const handle = await session.open(source, policy);
          const value = await session.materialize(handle.id, {kind: "BYTES", maxBytes: source.sizeBytes});
          if (value.kind !== "BYTES") {throw new Error("wrong kind");}
          hashes.push(value.receipt.localSha256); backends.push(session.stats.backend);
        } finally {await session.close();}
      }
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), context, {fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
      try {
        const reader = await session.open({...source, transport: "RANGE_REQUIRED"}, {...policy, mode: "RANGE", bridge: "ASYNC", result: "READER"});
        const range = new Uint8Array(7); await reader.readInto(524280, range);
        const workspace = await session.open(source, {...policy, result: "WORKSPACE_FILE", workspace: "OPFS_REQUIRED"});
        let written = 0, commits = 0, aborted = 0; const reported: number[] = [];
        const started = performance.now();
        await session.materialize(workspace.id, {kind: "SINK", maxBytes: source.sizeBytes, createSink: async () => ({
          write: async (offset, chunk) => {if (offset !== written) {throw new Error("offset");} await new Promise((resolve) => setTimeout(resolve, 1400)); written += chunk.length;},
          commit: async () => {if (reported.includes(source.sizeBytes)) {throw new Error("premature 100%");} commits++;},
          abort: async () => {aborted++;}})}, undefined, (progress) => reported.push(progress.readyBytes));
        return {hashes, backends, written, commits, aborted, reported, duration: performance.now() - started, range: Array.from(range)};
      } finally {await session.close();}
    }, {identity});
    expect(result.hashes).toEqual([identity.identity.kind === "FILE_SHA256" ? identity.identity.sha256 : "", identity.identity.kind === "FILE_SHA256" ? identity.identity.sha256 : ""]);
    expect(result.backends).toEqual(["OPFS", "OPFS"]); expect(result.written).toBe(identity.sizeBytes); expect(result.commits).toBe(1); expect(result.aborted).toBe(0);
    expect(result.duration).toBeGreaterThan(5000); expect(result.reported.filter((value) => value === identity.sizeBytes)).toHaveLength(1);
    expect(server.requests("game").map((request) => request.range)).toEqual([null]);
  } finally {await server.close();}
});
test("[ST-08] BROWSER/Blob File keeps the immutable OPFS generation leased after its reader closes @S07",async({page})=>{
 const helper=(await build({stdin:{contents:`export {ContentMetadata} from './src/content-io/store/metadata.ts';export {ContentLocks} from './src/content-io/store/locks.ts';export {OPFSStore} from './src/content-io/store/opfs.ts';export {ContentGC} from './src/content-io/store/gc.ts';`,resolveDir:process.cwd()},bundle:true,format:"esm",platform:"browser",write:false})).outputFiles[0].text;
 const server=await startFixtureServer({contentModule:await bundle("client"),modules:{"worker.mjs":await bundle("worker"),"gc.mjs":helper}});
 const identity=server.register({id:"blob",fixtureId:"multi-tail",behavior:"NORMAL",seed:17,delayBeforeHeadersMs:null,chunkDelayMs:null,disconnectAfterBytes:null,barrier:null});
 try{
 await page.goto(`${server.origin}/__test__/page`);
 const result=await page.evaluate(async({identity})=>{
  const url="/__test__/content.mjs",gcUrl="/__test__/gc.mjs";
  const {createContentSession}=await import(url) as typeof import("../../src/content-io/client.js");
  const {ContentMetadata,ContentLocks,OPFSStore,ContentGC}=await import(gcUrl);
  const diagnostics: ContentDiagnostic[] = [];
  const session=await createContentSession(new Worker("/__test__/worker.mjs",{type:"module"}),{storageOrigin:location.origin,allowedOrigins:[location.origin]}, {onDiagnostic: value => diagnostics.push(value), fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 262144}});
  const metadata=await ContentMetadata.open();
  try{
   const reader=await session.open({identity:identity.identity,sizeBytes:identity.sizeBytes,url:`${location.origin}/objects/multi-tail/blob`,purpose:"GAME",transport:"WHOLE_ALLOWED",etagPolicy:"EXPECTED_SHA256",contentLengthPolicy:"EXACT_IF_PRESENT",},
    {mode:"EAGER",bridge:"NONE",result:"BLOB",maxFileBytes:identity.sizeBytes,workspace:"NONE",writes:"DENY",contentLengthPolicy:"EXACT_IF_PRESENT",});
   const value=await session.materialize(reader.id,{kind:"BLOB",maxBytes:identity.sizeBytes});if(value.kind!=="BLOB"){throw new Error("kind");}
   await reader.close();const gc=new ContentGC(metadata,new ContentLocks(),[await OPFSStore.open()]);
   const held=await gc.collect(0),tag=Object.prototype.toString.call(value.blob),size=value.blob.size;
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await value.blob.arrayBuffer())),n=>n.toString(16).padStart(2,"0")).join("");
   await value.release();await value.release();const released=await gc.collect(0);return{held,released,tag,size,hash,diagnostics};
  }finally{metadata.close();await session.close();}
 },{identity});
 expect(result).toMatchObject({tag:"[object File]",held:0,released:1,size:identity.sizeBytes});expect(result.hash).toBe(identity.identity.kind==="FILE_SHA256"?identity.identity.sha256:"");
 expect(result.diagnostics.at(-1)).toMatchObject({operation: "CLOSE", codeNumber: 0, counts: {
   leases: 0, peakLeases: 2, materializedBytesByBlob: identity.sizeBytes, materializedBytes: identity.sizeBytes,
   cacheBytesL1: 0, cacheBytesL2: 0, temporaryBytes: 0, outputCreditBytes: 0, channels: 0,
 }});
 expect(server.requests("blob")).toHaveLength(1);
 }finally{await server.close();}
});
