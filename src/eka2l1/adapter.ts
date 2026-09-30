import type {MountedRuntimeAdapter} from "../internal-adapter.js";
import type {AdapterContentOptions} from "../provider/content-inputs.js";
import type {RuntimeCheckpoint} from "../contract.js";
import {installInput} from "./input.js";
import type {EKA2L1Parameters,SessionLoader,BrowserSession} from "./core.js";
import {loadSession} from "./loader.js";
import {createNativeDialogs} from "./dialogs.js";
const format="eka2l1-game-save-v1",maximum=64*1024*1024;
const save={dataKind:"STORAGE",capture:"IN_GAME",restore:"IN_GAME",captureAvailable:false} as const;
export async function mountEKA2L1(config:EKA2L1Parameters,target:HTMLElement,win:Window,restore:Uint8Array|null,
  reportFailure:(error:Error)=>void,signal?:AbortSignal,loader:SessionLoader=loadSession,content?:AdapterContentOptions,
  diagnostic:(message:string)=>void=()=>{}):Promise<MountedRuntimeAdapter>{
  if(target.ownerDocument!==win.document)throw new Error("EKA2L1_RUNTIME_CONFIG_INVALID");
  const canvas=win.document.createElement("canvas");canvas.id="canvas";canvas.tabIndex=0;canvas.width=240;canvas.height=320;
  canvas.setAttribute("aria-label","Symbian game");target.append(canvas);
  const rotate=win.document.createElement("button");rotate.type="button";rotate.textContent="↻";rotate.setAttribute("aria-label","Rotate game display");
  Object.assign(rotate.style,{position:"absolute",right:"16px",bottom:"80px",zIndex:"2",padding:"8px",cursor:"pointer"});target.append(rotate);
  const options={rotation:config.rotation,confirmKey:config.confirmKey};
  let session:BrowserSession|undefined,controls:ReturnType<typeof installInput>|undefined,stopped=false,failed=false,paused=false,dialogOpen=false,exiting:Promise<void>|undefined;
  const dialogs=createNativeDialogs(win,target,()=>session,blocked=>{dialogOpen=blocked;controls?.pause(blocked||paused);});
  const exit=()=>exiting??= (async()=>{
    stopped=true;controls?.stop();signal?.removeEventListener("abort",abort);
    try{await session?.stop();}finally{dialogs.close();rotate.remove();canvas.remove();}
  })();
  const abort=()=>{void exit().catch(reportFailure);};
  const active=()=>{if(stopped||failed)throw new Error("EKA2L1_RUNTIME_EXITED");};
  try{
    session=await loader(config,win,canvas,signal,content,event=>{
      if(event.stage==="error"){failed=true;reportFailure(new Error(`EKA2L1_RUNTIME_FAILED: ${event.detail??"unknown"}`));}
      if(event.stage==="log"||event.stage==="log-error")diagnostic(event.detail??"");
    },dialogs.show);
    signal?.throwIfAborted();
    if(restore){validateBytes(restore);await session.importSave(restore);}
    signal?.throwIfAborted();await session.start();signal?.throwIfAborted();
    const core=session;
    controls=installInput(win,options,(key,pressed)=>{try{core.key(key,pressed);}catch(error){failed=true;reportFailure(asError(error));void exit().catch(reportFailure);}});
    rotate.onclick=()=>{
      controls?.pause(true);options.rotation=(options.rotation+90)%360;core.setRotation(options.rotation);controls?.pause(paused||dialogOpen);canvas.focus();
    };
    signal?.addEventListener("abort",abort,{once:true});canvas.focus();
  }catch(error){await exit();throw error;}
  const core=session;
  return {
    exit,getCanvas:()=>stopped?null:canvas,getFrameCount:()=>stopped?null:core.frames(),
    getCheckpointAvailability:()=>{
      if(stopped)return {available:false,blocker:"NOT_READY",save};
      if(failed)return {available:false,blocker:"FAILED",save};
      if(!core.saveAvailable())return {available:false,blocker:"NO_SAVE",save};
      if(!core.saveDirty())return {available:false,blocker:"UNCHANGED",save};
      return {available:true,blocker:null,revision:String(core.journal.generation),save};
    },
    async checkpoint(){active();if(!core.saveAvailable())throw new Error("EKA2L1_NO_NATIVE_SAVE");
      controls?.pause(true);
      try{const bytes=await core.exportSave();validateBytes(bytes);return {format,bytes};}
      finally{controls?.pause(paused||dialogOpen);}},
    async acknowledgeCheckpoint(checkpoint:RuntimeCheckpoint){active();if(checkpoint.format!==format)throw new Error("EKA2L1_SAVE_FORMAT_INVALID");validateBytes(checkpoint.bytes);await core.acknowledgeSave(checkpoint.bytes);},
    async pause(){active();paused=true;controls?.pause(true);await core.pause();},
    async resume(){active();await core.resume();paused=false;controls?.pause(dialogOpen);},
    async screenshot(){active();return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?.size?resolve(blob):reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE")),"image/png"));},
    setVolume:null,
  };
}
function validateBytes(bytes:Uint8Array){if(!bytes.byteLength||bytes.byteLength>maximum)throw new Error("EKA2L1_SAVE_SIZE_INVALID");}
function asError(error:unknown){return error instanceof Error?error:new Error("EKA2L1_INPUT_FAILED");}
