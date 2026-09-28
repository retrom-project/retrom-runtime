import type {RuntimeProgressReporter} from "../internal-adapter.js";
import type {ButterscotchParameters} from "./parameters.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {fetchMetadataJson, indexByteBudget} from "../provider/metadata.js";
import {ContentIOError} from "../content-io/errors.js";
import {LazyContentReader} from "../provider/lazy-reader.js";
import {serveContentReads} from "./content-bridge.js";
type ProjectFile = {path: string; sizeBytes: number; url: string};
type ProjectIndex = {files: ProjectFile[]; schemaVersion: 1};
type ProjectConfig = Pick<ButterscotchParameters, "contentDigest" | "sessionId" | "projectIndexUrl">;
const maximumProjectFiles = 10_000;
export async function prepareButterscotchProject(config: ProjectConfig, frameWindow: Window,
  reportProgress: RuntimeProgressReporter, content?: AdapterContentOptions & {signal?: AbortSignal}) {
  if (!content) {throw new ContentIOError("ABI_MISMATCH");}
  reportProgress({phase:"PROJECT_INDEX",loadedBytes:0,totalBytes:null});
  const base = new URL(config.projectIndexUrl,frameWindow.document.baseURI), budget = indexByteBudget(maximumProjectFiles,1024);
  const value = await fetchMetadataJson(base,budget,content.signal);
  if (!validProjectIndex(value)) {throw new Error("BUTTERSCOTCH_PROJECT_INDEX_INVALID");}
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
  let disconnect:(()=>void)|undefined, released=false;
  const release=()=>{
    if(released){return;} released=true; disconnect?.();
    content.signal?.removeEventListener("abort",release);
    void Promise.all(readers.map(reader=>reader.close()));
  };
  content.signal?.addEventListener("abort",release,{once:true});
  if(content.signal?.aborted){release();content.signal.throwIfAborted();}
  return {
    gamePath:`/content/${game.path}`,savePath:`${persistentSaves?"/butterscotch":""}/saves/${config.sessionId}`,persistentSaves,
    files:value.files.map((file,id)=>({id,path:`/content/${file.path}`,sizeBytes:file.sizeBytes})),
    connect(buffer:SharedArrayBuffer,offset:number){
      if(released||disconnect){throw new ContentIOError("ABORTED");}
      disconnect=serveContentReads(buffer,offset,readers,error=>{release();content.onFailure?.(error);});
    },release,
  };
}

function validProjectIndex(value: unknown): value is ProjectIndex {
  if (!isRecord(value) || !exactKeys(value, ["files", "schemaVersion"]) || value.schemaVersion !== 1 ||
    !Array.isArray(value.files) || value.files.length < 1 || value.files.length > maximumProjectFiles) {return false;}
  const identities = new Set<string>();
  let totalBytes = 0;
  let dataWinCount = 0;
  for (const file of value.files) {
    if (!isRecord(file) || !exactKeys(file, ["path", "sizeBytes", "url"]) || !validPath(file.path) ||
      !validProjectUrl(file.url) || !Number.isSafeInteger(file.sizeBytes) || Number(file.sizeBytes) < 1) {return false;}
    const identity = file.path.toLowerCase();
    if (identities.has(identity)) {return false;}
    identities.add(identity);
    totalBytes += Number(file.sizeBytes);
    if (!Number.isSafeInteger(totalBytes)) {return false;}
    if (identity === "data.win") {dataWinCount += 1;}
  }
  return dataWinCount === 1;
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && value.normalize("NFC") === value &&
    !value.startsWith("/") && !value.includes("\\") && !value.includes("//") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
function validProjectUrl(value: unknown) {
  if (typeof value !== "string") {return false;}
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes("#")) {return true;}
  try {return ["http:", "https:"].includes(new URL(value).protocol);} catch {return false;}
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}
