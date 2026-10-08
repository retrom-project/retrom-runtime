import type {RuntimeProgressReporter} from "../internal-adapter.js";
import type {ButterscotchParameters} from "./parameters.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {fetchMetadataJson, indexByteBudget} from "../provider/metadata.js";
import {ContentIOError} from "../content-io/errors.js";
import {LazyContentReader} from "../provider/lazy-reader.js";
import {serveContentReads} from "./content-bridge.js";
import {parseProjectIndex} from "../provider/project-index.js";
type ProjectConfig = Pick<ButterscotchParameters, "contentDigest" | "sessionId" | "projectIndexUrl">;
const maximumProjectFiles = 10_000;
export async function prepareButterscotchProject(config: ProjectConfig, frameWindow: Window,
  reportProgress: RuntimeProgressReporter, content?: AdapterContentOptions & {signal?: AbortSignal}) {
  if (!content) {throw new ContentIOError("ABI_MISMATCH");}
  reportProgress({phase:"PROJECT_INDEX",loadedBytes:0,totalBytes:null});
  const base = new URL(config.projectIndexUrl,frameWindow.document.baseURI), budget = indexByteBudget(maximumProjectFiles,1024);
  const value = parseProjectIndex(await fetchMetadataJson(base,budget,content.signal), maximumProjectFiles);
  if (!value || value.files.filter(file => file.path.toLowerCase() === "data.win").length !== 1 || value.files.some(file => file.sizeBytes < 1)) {throw new Error("BUTTERSCOTCH_PROJECT_INDEX_INVALID");}
  reportProgress({phase:"PROJECT_INDEX",loadedBytes:1,totalBytes:1});
  const policy=content.contentSession.inputPolicy("game");
  const readers=value.files.map(file=>new LazyContentReader(content.contentSession,{
    identity:{kind:"INDEX_ENTRY",projectDigest:config.contentDigest,logicalPath:file.path},url:new URL(file.url,base).href,
    sizeBytes:file.sizeBytes,purpose:"GAME",transport:"RANGE_REQUIRED",etagPolicy:"PIN_STRONG",contentLengthPolicy:policy.contentLengthPolicy,
  },policy,content.signal));
  // OPFS is only an optional native-save store; it is no longer a game workspace.
  let persistentSaves=false;
  try {
    const root=await frameWindow.navigator.storage.getDirectory();
    await(await root.getDirectoryHandle("saves",{create:true})).getDirectoryHandle(config.sessionId,{create:true});
    persistentSaves=true;
  } catch { /* Native saves can use the session overlay when browser storage is unavailable. */ }
  const game=value.files.find(file=>file.path.toLowerCase()==="data.win")!;
  let disconnect:(()=>void)|undefined, released=false, closing:Promise<void>|undefined;
  const release=()=>{
    if(closing){return closing;} released=true; disconnect?.();
    content.signal?.removeEventListener("abort",abortRelease);
    closing=Promise.allSettled(readers.map(reader=>reader.close())).then(results=>{
      for(const result of results){
        if(result.status!=="rejected"){continue;}
        if(content.signal?.aborted&&result.reason instanceof ContentIOError&&result.reason.code==="CONTENT_IO_ABORTED"){continue;}
        throw result.reason;
      }
    });
    return closing;
  };
  const abortRelease=()=>{void release().catch(error=>content.onFailure?.(error));};
  content.signal?.addEventListener("abort",abortRelease,{once:true});
  if(content.signal?.aborted){await release();content.signal.throwIfAborted();}
  return {
    gamePath:`/content/${game.path}`,savePath:`${persistentSaves?"/butterscotch":""}/saves/${config.sessionId}`,persistentSaves,
    files:value.files.map((file,id)=>({id,path:`/content/${file.path}`,sizeBytes:file.sizeBytes})),
    connect(buffer:SharedArrayBuffer,offset:number){
      if(released||disconnect){throw new ContentIOError("ABORTED");}
      disconnect=serveContentReads(buffer,offset,readers,error=>{
        // The read failure owns this forced teardown; retain that original error.
        void release().catch(()=>undefined);content.onFailure?.(error);
      });
    },release,
  };
}
