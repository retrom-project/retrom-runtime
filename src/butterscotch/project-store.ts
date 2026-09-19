import type {RuntimeProgressReporter} from "../internal-adapter.js";
import type {ButterscotchParameters} from "./parameters.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {fetchMetadataJson, indexByteBudget} from "../provider/metadata.js";
import {prepareWorkspaceProject, type WorkspaceInput} from "../content-io/sinks/workspace.js";
import {ContentIOError} from "../content-io/errors.js";
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
  let root:FileSystemDirectoryHandle;
  try {root=await frameWindow.navigator.storage.getDirectory();}
  catch(cause){throw new ContentIOError("WORKSPACE_UNAVAILABLE",{cause});}
  const inputs:WorkspaceInput[]=value.files.map(file=>({path:file.path,source:{
    identity:{kind:"INDEX_ENTRY",projectDigest:config.contentDigest,logicalPath:file.path},url:new URL(file.url,base).href,
    sizeBytes:file.sizeBytes,purpose:"GAME",transport:"WHOLE_ALLOWED",etagPolicy:"PIN_STRONG",contentLengthPolicy:"EXACT_IF_PRESENT",}}));
  const project=await prepareWorkspaceProject(root,config.contentDigest,inputs,content.contentSession,location.origin,budget,content.signal,
    (loadedBytes,totalBytes)=>reportProgress({phase:"PROJECT_CONTENT",loadedBytes,totalBytes}));
  try {
    await(await root.getDirectoryHandle("saves",{create:true})).getDirectoryHandle(config.sessionId,{create:true});
    const game=value.files.find(file=>file.path.toLowerCase()==="data.win")!;
    return {gamePath:`/butterscotch/${project.dataPath}/${game.path}`,savePath:`/butterscotch/saves/${config.sessionId}`,release:project.release};
  } catch(cause){project.release();throw new ContentIOError("WORKSPACE_UNAVAILABLE",{cause});}
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
