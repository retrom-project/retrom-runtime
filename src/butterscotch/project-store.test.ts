import {afterEach,expect,it,vi} from "vitest";
import {prepareButterscotchProject} from "./project-store.js";
import {prepareWorkspaceProject} from "../content-io/sinks/workspace.js";
import {managedAdapterFixture} from "../../tests/managed-adapter-fixture.js";
vi.mock("../content-io/sinks/workspace.js",()=>({prepareWorkspaceProject:vi.fn(async()=>({generation:"generation",dataPath:"projects/project/generation/data",release:vi.fn()}))}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it("maps immutable project entries into a public workspace generation and preserves the native save root",async()=>{
 const config={contentDigest:"b".repeat(64),sessionId:"launch-one",projectIndexUrl:"https://content.example/index.json"};
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({schemaVersion:1,files:[{path:"Data.win",sizeBytes:4,url:"/data.win"}]})));
 const getDirectoryHandle=vi.fn(async()=>({getDirectoryHandle:vi.fn()}));
 const realm={document:{baseURI:location.href},navigator:{storage:{getDirectory:async()=>({getDirectoryHandle})}}} as unknown as Window;
 const content=managedAdapterFixture(config),result=await prepareButterscotchProject(config,realm,vi.fn(),content);
 expect(result.gamePath).toBe("/butterscotch/projects/project/generation/data/Data.win");expect(result.savePath).toBe("/butterscotch/saves/launch-one");
 expect(vi.mocked(prepareWorkspaceProject).mock.calls.at(-1)?.[2]).toEqual([{path:"Data.win",source:{
   identity:{kind:"INDEX_ENTRY",projectDigest:"b".repeat(64),logicalPath:"Data.win"},url:"https://content.example/data.win",sizeBytes:4,
   purpose:"GAME",transport:"WHOLE_ALLOWED",etagPolicy:"PIN_STRONG",contentLengthPolicy:"EXACT_IF_PRESENT",}}]);
 expect(getDirectoryHandle).toHaveBeenCalledWith("saves",{create:true});result.release();
});
