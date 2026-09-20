import type {AdapterContentOptions} from "../provider/content-inputs.js";
import {fileContentSource, materializeFileBytes} from "../provider/content-inputs.js";
import {LazyContentReader} from "../provider/lazy-reader.js";
import {eagerPolicy, rangePolicy} from "../provider/content-policies.js";
import {abi,contractSha256} from "../content-io/identity.js";
import {ContentIOError,errorNumbers, type ContentErrorName} from "../content-io/errors.js";
import {checkSignal} from "../content-io/abort.js";
import {validateSource} from "../content-io/source.js";
type File = {url:string;sha256:string;sizeBytes:number};
type NativeModule = {retromContentClosed?:boolean;retromContentClose?:()=>void};
/** UI-owned bridge. The core only receives opaque IDs and immutable size/path metadata. */
export class MkxpContent {
  private readonly readers = new Map<string,{reader:LazyContentReader;path:string}>();
  private readonly controller = new AbortController();
  private native?:NativeModule;
  private closing?:Promise<void>;
  readonly bridge = {
    abi,contractSha256,
    readIntoById: async (fileId:string,offset:number,destination:Uint8Array,signal?:AbortSignal) => {
      checkSignal(this.controller.signal);checkSignal(this.signal);
      const entry=this.readers.get(fileId);if(!entry){throw new ContentIOError("SOURCE_INVALID");}
      return entry.reader.readInto(offset,destination,signal);
    },
    reportFailure: (code:number) => {
      const name=(Object.keys(errorNumbers) as ContentErrorName[]).find(key=>errorNumbers[key]===code) ?? "INTERNAL";
      this.onFailure(new ContentIOError(name));
    },
  };
  private readonly onAbort=()=>{void this.close();};
  constructor(private readonly options:AdapterContentOptions,private readonly onFailure:(error:Error)=>void,
    private readonly signal?:AbortSignal) {signal?.addEventListener("abort",this.onAbort,{once:true});}
  attach(module:NativeModule) {this.native=module;if(this.controller.signal.aborted){module.retromContentClosed=true;module.retromContentClose?.();}}
  register(file:File,path:string,purpose:"GAME"|"FIRMWARE") {
    checkSignal(this.controller.signal);checkSignal(this.signal);
    if(this.readers.size>=128 || !path.startsWith("/") || ([...path].some(char=>char.charCodeAt(0)<32 || char.charCodeAt(0)===127) || path.includes("\\")) ||
      path.split("/").slice(1).some(part=>!part || part==="." || part==="..") ||
      [...this.readers.values()].some(entry=>entry.path===path)) {throw new ContentIOError("SOURCE_INVALID");}
    const policy=rangePolicy("WASMFS",Number.MAX_SAFE_INTEGER,{writes:"SESSION_OVERLAY"}),source=fileContentSource(file,policy,purpose);
    validateSource(source,{storageOrigin:location.origin,allowedOrigins:[new URL(source.url).origin]});
    const reader=new LazyContentReader(this.options.contentSession,source,policy,this.signal);
    this.readers.set(reader.id,{reader,path});return reader;
  }
  manifest() {return ["RETROM_CONTENT_IO_V1",...[...this.readers.values()].map(({reader,path})=>`${reader.id}\t${reader.sizeBytes}\t${path}`),""].join("\n");}
  close():Promise<void> {
    if(!this.closing){this.controller.abort();this.signal?.removeEventListener("abort",this.onAbort);
      if(this.native){this.native.retromContentClosed=true;this.native.retromContentClose?.();}
      this.closing=Promise.all([...this.readers.values()].map(({reader})=>reader.close())).then(()=>{this.readers.clear();});}
    return this.closing;
  }
}
export async function fetchVerified(url:string,expectedSize:number,expectedDigest:string,content?:AdapterContentOptions,signal?:AbortSignal) {
  if(!content){throw new ContentIOError("ABI_MISMATCH");}
  return materializeFileBytes(content.contentSession,{url,sha256:expectedDigest,sizeBytes:expectedSize},eagerPolicy(128*1024*1024),"CORE_ASSET",signal);
}
