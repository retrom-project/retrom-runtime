// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {loadSession} from "./loader.js";
import type {EKA2L1Parameters} from "./core.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
const {loadCoreAsset,createSession}=vi.hoisted(()=>({loadCoreAsset:vi.fn(async():Promise<Uint8Array>=>{throw new Error("verified asset boundary");}),createSession:vi.fn(async()=>({stop:vi.fn(async()=>{})}))}));
vi.mock("../provider/core-assets.js",()=>({loadCoreAsset}));
vi.mock("./bundle.js",()=>({unpackBundle:()=>({"eka2l1.js":Uint8Array.of(1),"eka2l1-browser.mjs":Uint8Array.of(2),"audio-worklet.mjs":Uint8Array.of(3),"eka2l1.wasm":Uint8Array.of(4),"build.json":new TextEncoder().encode(JSON.stringify({sourceTreeSha256:"b".repeat(64)}))})}));
vi.mock("../provider/core-module.js",()=>({importCoreModule:async()=>({abi:"eka2l1-browser-v1",createSession})}));
vi.mock("./content.js",()=>({prepareInputs:async()=>({sis:Uint8Array.of(1),rom:Uint8Array.of(2),rpkg:Uint8Array.of(3)})}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it("resolves the Host's relative Provider URL before loading verified bytes",async()=>{
  const config={runtimeBaseUrl:"/runtime/providers/retrom-runtime/digest/assets/eka2l1/"} as EKA2L1Parameters;
  const content={} as AdapterContentOptions;
  await expect(loadSession(config,window,document.createElement("canvas"),undefined,content)).rejects.toThrow("verified asset boundary");
  expect(loadCoreAsset).toHaveBeenCalledWith(content,new URL(config.runtimeBaseUrl+"eka2l1-runtime.zip",location.href).href,
    "assets/eka2l1/eka2l1-runtime.zip",64*1024*1024,undefined);
});
it("passes the verified complete core build identity to the derived installation cache",async()=>{
  loadCoreAsset.mockResolvedValueOnce(Uint8Array.of(1));
  vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:verified");
  vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
  Object.assign(window,{createEKA2L1:()=>{}});
  vi.spyOn(document.head,"append").mockImplementation((...nodes)=>{queueMicrotask(()=>(nodes[0] as HTMLScriptElement).dispatchEvent(new Event("load")));});
  const session=await loadSession({runtimeBaseUrl:"/provider/"} as EKA2L1Parameters,window,document.createElement("canvas"),undefined,{} as AdapterContentOptions);
  expect(createSession).toHaveBeenCalledWith(expect.objectContaining({installationBuildId:"b".repeat(64)}));
  await session.stop();
});
