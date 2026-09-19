import type {ContentSourceV1, MaterializationReceiptV1, MaterializeSinkV1} from "../../../contracts/content-io/v1/content-io.js";
import type {AdapterContentSession} from "../../provider/content-inputs.js";
import {eagerPolicy} from "../../provider/content-policies.js";
import {boundedJson} from "../../provider/metadata.js";
import {checkSignal} from "../abort.js";
import {createContentHasher} from "../bounded-stream.js";
import {ContentIOError, fail} from "../errors.js";
import {BLOCK_BYTES, canonicalPath, contentObjectKey, exact, isDigest, validateSource} from "../source.js";
import {ContentLocks} from "../store/locks.js";
export type WorkspaceInput = {path: string; source: ContentSourceV1};
type FileReceipt = Pick<MaterializationReceiptV1, "objectKey" | "sizeBytes" | "localSha256" | "assurance" | "pinnedEtag"> & {path: string};
type Marker = {schemaVersion: 1; projectDigest: string; generation: string; files: FileReceipt[]};
export type WorkspaceProject = {generation: string; dataPath: string; release(): void};
const generationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
/** A workspace is a required native delivery copy, with no downloader or separate raw cache. */
export async function prepareWorkspaceProject(root: FileSystemDirectoryHandle, digest: string, inputs: readonly WorkspaceInput[],
  session: AdapterContentSession, storageOrigin: string, metadataBudget: number, signal?: AbortSignal,
  report: (ready: number, total: number) => void = () => {}, locks: ContentLocks | null = navigator.locks ? new ContentLocks() : null): Promise<WorkspaceProject> {
  validateInputs(digest, inputs, storageOrigin); checkSignal(signal);
  const sorted = [...inputs].sort((a,b) => utf8Order(a.path,b.path)), total = sorted.reduce((sum, file) => sum + file.source.sizeBytes, 0);
  if (!Number.isSafeInteger(total)) {fail("BOUNDS");}
  try {
    const projects = await root.getDirectoryHandle("projects", {create:true});
    const project = await projects.getDirectoryHandle(digest, {create:true});
    const existing = locks && await findWorkspace(project, digest, sorted, storageOrigin, metadataBudget, locks, signal);
    if (existing) {report(total,total); return existing;}
    const generation = crypto.randomUUID(), release = locks ? await locks.use(workspaceKey(digest,generation),signal) : () => {};
    let complete = false;
    try {
      const directory = await project.getDirectoryHandle(generation,{create:true});
      await buildWorkspace(directory,digest,generation,sorted,session,storageOrigin,total,signal,report); complete = true;
      if (locks) {await publishWorkspace(project,digest,generation,storageOrigin,locks,signal);}
      checkSignal(signal); report(total,total);
      return {generation,dataPath:`projects/${digest}/${generation}/data`,release};
    } catch (error) {release(); if (!complete) {await project.removeEntry(generation,{recursive:true}).catch(()=>{});} throw error;}
  } catch(cause) {checkSignal(signal);if(cause instanceof ContentIOError){throw cause;}throw new ContentIOError("WORKSPACE_UNAVAILABLE",{cause});}
}
async function buildWorkspace(directory: FileSystemDirectoryHandle,digest: string,generation: string,inputs: WorkspaceInput[],
  session: AdapterContentSession,storageOrigin: string,total: number,signal: AbortSignal | undefined,report: (ready:number,total:number)=>void) {
  const data = await directory.getDirectoryHandle("data",{create:true}), meta = await directory.getDirectoryHandle("meta",{create:true});
  const receipts: FileReceipt[]=[];let ready=0;report(0,total);
  for (const input of inputs) {
    checkSignal(signal);const target=await fileTarget(data,input.path,true);
    const policy=eagerPolicy(input.source.sizeBytes,{result:"WORKSPACE_FILE",workspace:"OPFS_REQUIRED",writes:"SESSION_OVERLAY"});
    const reader=await session.open(input.source,policy,signal);
    try {
      const result=await session.materialize(reader.id,{kind:"SINK",maxBytes:input.source.sizeBytes,
        createSink:()=>createWorkspaceSink(target,input.source,storageOrigin,signal)},signal,
      value=>report(Math.min(Math.max(0,total-1),ready+value.readyBytes),total));
      if(result.kind!=="SINK"){fail("INTERNAL");}
      const r=result.receipt;receipts.push({path:input.path,objectKey:r.objectKey,sizeBytes:r.sizeBytes,
        localSha256:r.localSha256,assurance:r.assurance,pinnedEtag:r.pinnedEtag});ready+=input.source.sizeBytes;
    } finally {await reader.close();}
  }
  checkSignal(signal);
  const marker:Marker={schemaVersion:1,projectDigest:digest,generation,files:receipts};
  const handle=await meta.getFileHandle("complete-v1.json",{create:true}),writer=await handle.createWritable();
  try {await writer.write(JSON.stringify(marker));checkSignal(signal);await writer.close();}
  catch(error){await writer.abort().catch(()=>{});throw error;}
}
export async function createWorkspaceSink(target: FileSystemFileHandle,source: ContentSourceV1,storageOrigin: string,signal?: AbortSignal): Promise<MaterializeSinkV1> {
  checkSignal(signal);const writer=await target.createWritable();let position=0,closed=false,committed=false;
  return {
    async write(offset,chunk){
      checkSignal(signal);if(closed||offset!==position||chunk.length>source.sizeBytes-position){fail("BOUNDS");}
      await writer.write(chunk as Uint8Array<ArrayBuffer>);checkSignal(signal);position+=chunk.length;
    },
    async commit(receipt){
      checkSignal(signal);if(closed||position!==source.sizeBytes||!validReceipt(receipt,source,storageOrigin)){fail("CHECKSUM_MISMATCH");}
      await writer.close();closed=true;
      if(!await verifyWorkspaceFile(target,source,receipt,storageOrigin,signal)){fail("CHECKSUM_MISMATCH");}committed=true;
    },
    async abort(){if(!closed&&!committed){closed=true;await writer.abort().catch(()=>{});}},
  };
}
export async function verifyWorkspaceFile(handle:FileSystemFileHandle,source:ContentSourceV1,
  receipt:Pick<MaterializationReceiptV1,"objectKey"|"sizeBytes"|"localSha256"|"assurance"|"pinnedEtag">,storageOrigin:string,signal?:AbortSignal):Promise<boolean>{
  checkSignal(signal);if(!validReceipt(receipt,source,storageOrigin)){return false;}
  const file=await handle.getFile();if(file.size!==source.sizeBytes){return false;}
  const hash=createContentHasher();
  try {
    for(let offset=0;offset<file.size;offset+=BLOCK_BYTES){checkSignal(signal);hash.update(new Uint8Array(await file.slice(offset,offset+BLOCK_BYTES).arrayBuffer()));}
    checkSignal(signal);return hash.digest()===receipt.localSha256;
  } finally {hash.destroy();}
}
function validReceipt(receipt:Pick<MaterializationReceiptV1,"objectKey"|"sizeBytes"|"localSha256"|"assurance"|"pinnedEtag">,source:ContentSourceV1,origin:string){
  if(receipt.objectKey!==contentObjectKey(source,origin)||receipt.sizeBytes!==source.sizeBytes||!isDigest(receipt.localSha256)){return false;}
  return source.identity.kind==="FILE_SHA256" ? receipt.assurance==="EXPECTED_SHA256"&&receipt.localSha256===source.identity.sha256 :
    receipt.assurance==="TRUSTED_IMMUTABLE_INDEX"&&(source.sizeBytes===0&&receipt.pinnedEtag===null||typeof receipt.pinnedEtag==="string"&&/^"[\x21\x23-\x7e\x80-\xff]*"$/u.test(receipt.pinnedEtag));
}
const currentName = ".content-io-current-v1.json";
async function publishWorkspace(project: FileSystemDirectoryHandle, digest: string, generation: string,
  origin: string, locks: ContentLocks, signal?: AbortSignal) {
  await locks.data(`workspace-current:${origin}:${digest}`, signal, async () => {
    const writer = await (await project.getFileHandle(currentName, {create: true})).createWritable();
    try {await writer.write(JSON.stringify({schemaVersion: 1, generation})); checkSignal(signal); await writer.close();}
    catch (error) {await writer.abort().catch(() => {}); throw error;}
  });
}
async function workspacePointer(project: FileSystemDirectoryHandle, signal?: AbortSignal): Promise<string | null> {
  try {
    const file = await (await project.getFileHandle(currentName)).getFile();
    const value = await boundedJson(new Response(file), 256, signal);
    return exact(value, ["schemaVersion", "generation"]) && value.schemaVersion === 1 &&
      typeof value.generation === "string" && generationPattern.test(value.generation) ? value.generation : null;
  } catch {checkSignal(signal); return null;}
}
async function findWorkspace(project:FileSystemDirectoryHandle,digest:string,inputs:WorkspaceInput[],origin:string,budget:number,locks:ContentLocks,signal?:AbortSignal){
  const name = await workspacePointer(project, signal); if (!name) {return null;}
  // Acquire the use lease before inspecting or hashing any generation contents.
  const release=await locks.use(workspaceKey(digest,name),signal);let keep=false;
  try {
    const directory=await project.getDirectoryHandle(name),meta=await directory.getDirectoryHandle("meta");
    const file=await(await meta.getFileHandle("complete-v1.json")).getFile();
    const marker=await boundedJson(new Response(file),budget,signal);
    if(!validMarker(marker,digest,name,inputs,origin)){return null;}
    const data=await directory.getDirectoryHandle("data");
    for(let i=0;i<inputs.length;i++){
      const target=await fileTarget(data,inputs[i].path,false);
      if(!await verifyWorkspaceFile(target,inputs[i].source,marker.files[i],origin,signal)){return null;}
    }
    keep=true;return {generation:name,dataPath:`projects/${digest}/${name}/data`,release};
  }catch{checkSignal(signal);return null;}finally{if(!keep){release();}}
}
function validMarker(value:unknown,digest:string,generation:string,inputs:WorkspaceInput[],origin:string):value is Marker {
  if(!exact(value,["schemaVersion","projectDigest","generation","files"])||value.schemaVersion!==1||value.projectDigest!==digest||value.generation!==generation||!Array.isArray(value.files)||value.files.length!==inputs.length){return false;}
  return value.files.every((raw:unknown,index:number)=>exact(raw,["path","objectKey","sizeBytes","localSha256","assurance","pinnedEtag"])&&raw.path===inputs[index].path&&validReceipt(raw as FileReceipt,inputs[index].source,origin));
}
async function fileTarget(root:FileSystemDirectoryHandle,path:string,create:boolean){
  const parts=path.split("/"),name=parts.pop()!;let directory=root;
  for(const part of parts){directory=await directory.getDirectoryHandle(part,{create});}
  return directory.getFileHandle(name,{create});
}
function workspaceKey(digest:string,generation:string){return `workspace:${digest}:${generation}`;}
function validateInputs(digest:string,inputs:readonly WorkspaceInput[],origin:string){
  if(!isDigest(digest)||!inputs.length){fail("SOURCE_INVALID");}const paths=new Set<string>();
  for(const file of inputs){
    if(!canonicalPath(file.path)||paths.has(file.path)){fail("SOURCE_INVALID");}paths.add(file.path);
    validateSource(file.source,{storageOrigin:origin,allowedOrigins:[new URL(file.source.url).origin]});
  }
}
function utf8Order(a:string,b:string){
  const encoder=new TextEncoder(),left=encoder.encode(a),right=encoder.encode(b);
  for(let i=0;i<Math.min(left.length,right.length);i++){if(left[i]!==right[i]){return left[i]-right[i];}}
  return left.length-right.length;
}
