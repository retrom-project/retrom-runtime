import type {AdapterContentOptions} from "../provider/content-inputs.js";
import type {KeypadOptions} from "./input.js";
import type {SymbianInputs} from "./content.js";
export type EKA2L1Parameters=SymbianInputs&KeypadOptions&{uid:number;runtimeBaseUrl:string};
export type BrowserSession={
  start():Promise<void>;stop():Promise<void>;pause():Promise<void>;resume():Promise<void>;
  importSave(bytes:Uint8Array):Promise<void>;exportSave():Promise<Uint8Array>;acknowledgeSave(bytes:Uint8Array):Promise<void>;
  saveAvailable():boolean;saveDirty():boolean;frames():number;
  key(code:number,pressed:boolean):void;reply(id:number,choice:number,text?:string):void;setRotation(value:number):void;
};
export type Dialog={id:number;text?:string;kind:string;buttons?:string[];maximum?:number};
export type SessionLoader=(config:EKA2L1Parameters,win:Window,canvas:HTMLCanvasElement,signal?:AbortSignal,
  content?:AdapterContentOptions,onEvent?:(event:{stage:string;detail?:string})=>void,
  onDialog?:(dialog:Dialog)=>void)=>Promise<BrowserSession>;
