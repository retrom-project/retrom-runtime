import {loadCoreAsset} from "../provider/core-assets.js";
import {importCoreModule} from "../provider/core-module.js";
import {prepareInputs} from "./content.js";
import {unpackBundle} from "./bundle.js";
import type {SessionLoader,BrowserSession} from "./core.js";
type BrowserAPI={abi:"eka2l1-browser-v1";createSession(options:Record<string,unknown>):Promise<BrowserSession>};
export const loadSession:SessionLoader=async(config,win,canvas,signal,content,onEvent,onDialog)=>{
  if(!content)throw new Error("CONTENT_IO_ABI_MISMATCH");
  const bytes=await loadCoreAsset(content,new URL("eka2l1-runtime.zip",new URL(config.runtimeBaseUrl,location.href)).href,"assets/eka2l1/eka2l1-runtime.zip",64*1024*1024,signal);
  const bundle=unpackBundle(bytes),urls:Record<string,string>={};
  const cleanup=()=>{for(const url of Object.values(urls))URL.revokeObjectURL(url);};
  try{
    for(const path of ["eka2l1.js","eka2l1-browser.mjs","audio-worklet.mjs"]){
      urls[path]=URL.createObjectURL(new Blob([new Uint8Array(bundle[path])],{type:"text/javascript"}));
    }
    await loadFactory(win,urls["eka2l1.js"],signal);
    const api=await importCoreModule(win,urls["eka2l1-browser.mjs"],"__RETROM_EKA2L1_BROWSER_V1__",signal);
    if(!validAPI(api))throw new Error("EKA2L1_ABI_MISMATCH");
    const files=await prepareInputs(config,content.contentSession,signal);
    signal?.throwIfAborted();
    const factory=(win as unknown as Record<string,unknown>).createEKA2L1;
    if(typeof factory!=="function")throw new Error("EKA2L1_ABI_MISMATCH");
    const session=await api.createSession({factory,canvas,files,assets:Object.entries(bundle).filter(([path])=>path.startsWith("resources/")||path.startsWith("patch/")).map(([path,bytes])=>({path:"/"+path,bytes})),
      uid:config.uid,rotation:config.rotation,wasmBinary:bundle["eka2l1.wasm"],installationBuildId:JSON.parse(new TextDecoder().decode(bundle["build.json"])).sourceTreeSha256,
      mainScriptURL:urls["eka2l1.js"],audioWorkletURL:urls["audio-worklet.mjs"],signal,onEvent,onDialog});
    const stop=session.stop.bind(session);let stopped=false;
    session.stop=async()=>{if(stopped)return;stopped=true;try{await stop();}finally{cleanup();}};
    return session;
  }catch(error){cleanup();throw error;}
};
function validAPI(value:unknown):value is BrowserAPI{
  if(!value||typeof value!=="object")return false;
  const api=value as Partial<BrowserAPI>;return api.abi==="eka2l1-browser-v1"&&typeof api.createSession==="function";
}
function loadFactory(win:Window,url:string,signal?:AbortSignal):Promise<void>{
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const script=win.document.createElement("script");script.src=url;
    const cleanup=()=>{win.clearTimeout(timer);signal?.removeEventListener("abort",abort);script.remove();};
    const fail=()=>{cleanup();reject(new Error("EKA2L1_MODULE_LOAD_FAILED"));};
    const abort=()=>{cleanup();reject(signal?.reason??new Error("EKA2L1_RUNTIME_EXITED"));};
    const timer=win.setTimeout(fail,30000);
    script.addEventListener("error",fail,{once:true});script.addEventListener("load",()=>{cleanup();resolve();},{once:true});
    signal?.addEventListener("abort",abort,{once:true});win.document.head.append(script);
  });
}
