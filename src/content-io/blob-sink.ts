import type {MaterializationReceiptV1} from "../../contracts/content-io/v1/content-io.js";
import {abortable,checkSignal,requestScope} from "./abort.js";
import type {BlockObject} from "./block-pool.js";
import type {BufferCredits} from "./credits.js";
import {ContentIOError,fail} from "./errors.js";
import {BlobSink,type ResultSink} from "./sinks.js";
import {BLOCK_BYTES} from "./source.js";
import type {PersistentBacking} from "./store/backing.js";
import type {ContentStoreManager} from "./store/manager.js";
/** Requests a fresh result when an optional OPFS delivery prefix cannot be replayed. */
export class BlobReplayRequired extends ContentIOError {constructor(){super("CACHE_UNAVAILABLE");}}
/** Starts without an O(N) Blob copy. Published OPFS generations are immutable. */
export class PersistentBlobSink implements ResultSink {
  private written=0;
  private memory?:BlobSink;
  private value?:Blob;
  private releaseLease?:()=>void;
  private stopped=false;
  constructor(private readonly object:BlockObject,private readonly backing:PersistentBacking,
    private readonly store:ContentStoreManager,private readonly credits:BufferCredits,private readonly signal:AbortSignal) {}
  async write(offset:number,bytes:Uint8Array) {
    this.check();if(offset!==this.written){fail("BOUNDS");}
    if(!this.memory&&this.store.persistent(this.object)!==this.backing){await this.replay();}
    if(this.memory){await this.memory.write(offset,bytes);}
    this.written+=bytes.length;
  }
  async commit(receipt:MaterializationReceiptV1) {
    this.check();if(this.written!==receipt.sizeBytes){fail("LENGTH_MISMATCH");}
    if(!this.memory){
      const scope=requestScope(this.signal,500);
      try {
        const current=await abortable(this.backing.resources.metadata.generation(this.backing.key,this.backing.generation),scope.signal);
        if(current?.state!=="COMPLETE"||current.localSha256!==receipt.localSha256){throw new Error("backing incomplete");}
        this.releaseLease=await this.store.lease(this.backing.resources,this.backing.key,scope.signal);
        const file=await abortable(this.backing.resources.data.file!(this.backing.key,this.backing.generation),scope.signal);
        if(file.size!==receipt.sizeBytes){throw new Error("backing size");}this.check();this.value=file;return;
      } catch(error) {
        this.releaseLease?.();this.releaseLease=undefined;checkSignal(this.signal);
        if(error instanceof ContentIOError&&error.scope==="OBJECT"){throw error;}
      } finally {scope.dispose();}
      await this.replay();
    }
    await this.memory!.commit(receipt);this.value=this.memory!.result();
  }
  async abort(reason:"CANCELLED"|"FAILED"|"RESTART") {this.stopped=true;this.releaseLease?.();this.releaseLease=undefined;await this.memory?.abort(reason);this.value=undefined;}
  result():Blob {this.check();if(!this.value){fail("RESOURCE_UNAVAILABLE");}const value=this.value;this.value=undefined;return value;}
  async release(){this.releaseLease?.();this.releaseLease=undefined;}
  private check(){checkSignal(this.signal);if(this.stopped){fail("ABORTED");}}
  private async replay() {
    const memory=new BlobSink(this.object.source.sizeBytes);
    try {
      for(let offset=0;offset<this.written;offset+=BLOCK_BYTES){
        this.check();const release=await this.credits.reserve(2*BLOCK_BYTES,"SCRATCH",this.signal);
        let scope: ReturnType<typeof requestScope> | undefined;
        try {
          scope=requestScope(this.signal,500);
          const bytes=await abortable(this.backing.read(offset/BLOCK_BYTES,scope.signal,true),scope.signal);
          if(!bytes){throw new BlobReplayRequired();}await memory.write(offset,bytes);
        } finally {release();scope?.dispose();}
      }
      this.memory=memory;
    }catch(error){
      await memory.abort("FAILED");checkSignal(this.signal);
      if(error instanceof ContentIOError&&error.scope==="OBJECT"){throw error;}throw new BlobReplayRequired();
    }
  }
}
