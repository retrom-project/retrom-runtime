import {test,expect} from "@playwright/test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {startFixtureServer} from "./fixture-server.mjs";
const bundle=async(path:string)=>(await build({entryPoints:[fileURLToPath(new URL(path,import.meta.url))],bundle:true,format:"esm",platform:"browser",write:false,target:"es2022"})).outputFiles[0].text;
test("[X-18] BROWSER/workspace [HP-02] BROWSER/workspace-progress complete generations verify every byte, preserve active instances and isolate saves @S17",async({page})=>{
  const index=new TextEncoder().encode(JSON.stringify({schemaVersion:1,files:[{path:"data.win",sizeBytes:4,url:"/files/game"},
    {path:".content-io-complete-v1.json",sizeBytes:2,url:"/files/legal"}]}));
  const server=await startFixtureServer({contentModule:await bundle("../../src/content-io/client.ts"),staticFiles:{index,game:new Uint8Array([1,2,3,4]),legal:new Uint8Array([5,6])},
    modules:{"worker.mjs":await bundle("../../src/content-io/worker.ts"),"project.mjs":await bundle("../../src/butterscotch/project-store.ts")}});
  try{
    await page.goto(`${server.origin}/__test__/page`);
    const result=await page.evaluate(async()=>{
      const clientUrl="/__test__/content.mjs",projectUrl="/__test__/project.mjs";
      const {createContentSession}=await import(clientUrl) as typeof import("../../src/content-io/client.js");
      const {prepareButterscotchProject}=await import(projectUrl) as typeof import("../../src/butterscotch/project-store.js");
      const root=await navigator.storage.getDirectory(), config={contentDigest:"a".repeat(64),sessionId:"launch-one",projectIndexUrl:"/files/index"};
      const releases:(()=>void)[]=[],sessions:Awaited<ReturnType<typeof createContentSession>>[]=[],progress:number[]=[];
      const make=async(id:string)=>{
        const session=await createContentSession(new Worker("/__test__/worker.mjs",{type:"module"}),{storageOrigin:location.origin,allowedOrigins:[location.origin]});sessions.push(session);
        const project=await prepareButterscotchProject({...config,sessionId:id},window,v=>{if(v.phase==="PROJECT_CONTENT"){progress.push(v.loadedBytes);}}, {contentSession:session,assetIndex:{}});
        releases.push(project.release);return project;
      };
      const handle=async(path:string)=>{const parts=path.replace(/^\/butterscotch\//u,"").split("/"),name=parts.pop()!;let dir=root;for(const part of parts){dir=await dir.getDirectoryHandle(part);}return dir.getFileHandle(name);};
      try{
        const first=await make("launch-one"),second=await make("launch-two");
        const source=await handle(first.gamePath),writer=await source.createWritable();await writer.write(new Uint8Array([9,9,9,9]));await writer.close();
        const third=await make("launch-three");
        const newBytes=Array.from(new Uint8Array(await(await(await handle(third.gamePath)).getFile()).arrayBuffer()));
        const oldBytes=Array.from(new Uint8Array(await(await source.getFile()).arrayBuffer()));
        const legal=Array.from(new Uint8Array(await(await(await handle(third.gamePath.replace(/data.win$/u,".content-io-complete-v1.json"))).getFile()).arrayBuffer()));
        await(await root.getDirectoryHandle("saves")).getDirectoryHandle("launch-one");
        await(await root.getDirectoryHandle("saves")).getDirectoryHandle("launch-two");
        return {first:first.gamePath,second:second.gamePath,third:third.gamePath,newBytes,oldBytes,legal,saveOne:first.savePath,saveTwo:second.savePath,progress};
      }finally{for(const release of releases){release();}await Promise.all(sessions.map(session=>session.close()));}
    });
    expect(result.first).toBe(result.second);expect(result.third).not.toBe(result.first);
    expect(result.first).toMatch(/\/projects\/a{64}\/[a-f0-9-]{36}\/data\/data.win$/u);
    expect(result.newBytes).toEqual([1,2,3,4]);expect(result.oldBytes).toEqual([9,9,9,9]);expect(result.legal).toEqual([5,6]);
    expect(result.saveOne).not.toBe(result.saveTwo);expect(result.progress.filter(n=>n===6)).toHaveLength(3);
    expect(server.fileRequests.filter(r=>r.name!=="index").map(r=>r.name).sort()).toEqual(["game","legal"]);
  }finally{await server.close();}
});

test("[ST-04] BROWSER/workspace-denied keeps optional cache separate from the required workspace @S06", async ({page}) => {
  const index = new TextEncoder().encode(JSON.stringify({schemaVersion: 1, files: [{path: "data.win", sizeBytes: 4, url: "/files/game"}]}));
  const server = await startFixtureServer({contentModule: await bundle("../../src/content-io/client.ts"),
    staticFiles: {index, game: new Uint8Array([1, 2, 3, 4])}, modules: {
      "worker.mjs": await bundle("../../src/content-io/worker.ts"), "project.mjs": await bundle("../../src/butterscotch/project-store.ts"),
    }});
  try {
    await page.goto(`${server.origin}/__test__/page`);
    const result = await page.evaluate(async () => {
      const clientUrl = "/__test__/content.mjs", projectUrl = "/__test__/project.mjs";
      const {createContentSession} = await import(clientUrl) as typeof import("../../src/content-io/client.js");
      const {prepareButterscotchProject} = await import(projectUrl) as typeof import("../../src/butterscotch/project-store.js");
      const session = await createContentSession(new Worker("/__test__/worker.mjs", {type: "module"}), {storageOrigin: location.origin, allowedOrigins: [location.origin]});
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([1, 2, 3, 4])))).map(n => n.toString(16).padStart(2, "0")).join("");
      try {
        const reader = await session.open({identity: {kind: "FILE_SHA256", sha256}, sizeBytes: 4, url: `${location.origin}/files/game`, purpose: "GAME",
          transport: "WHOLE_ALLOWED", etagPolicy: "EXPECTED_SHA256", contentLengthPolicy: "EXACT_IF_PRESENT"},
        {mode: "EAGER", bridge: "NONE", result: "BYTES", maxFileBytes: 4, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
        await session.materialize(reader.id, {kind: "BYTES", maxBytes: 4});
        navigator.storage.getDirectory = async () => {throw new DOMException("denied", "NotAllowedError");};
        let failure = "";
        try {await prepareButterscotchProject({contentDigest: "a".repeat(64), sessionId: "denied", projectIndexUrl: "/files/index"},
          window, () => {}, {contentSession: session, assetIndex: {}});}
        catch (error) {failure = (error as Error).message;}
        return {failure, backend: session.stats.backend};
      } finally {await session.close();}
    });
    expect(result).toEqual({failure: "CONTENT_IO_WORKSPACE_UNAVAILABLE", backend: "OPFS"});
    expect(server.fileRequests.map(request => request.name)).toEqual(["game", "index"]);
  } finally {await server.close();}
});
