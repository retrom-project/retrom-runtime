import type {MaterializeSinkV1} from "../../contracts/content-io/v1/content-io.js";
import {abortable,checkSignal,requestScope} from "./abort.js";
import {ContentIOError} from "./errors.js";
/** Bound required local operations without imposing a deadline on the entire download. */
export async function sinkOperation<Value>(action:()=>Promise<Value>,signal:AbortSignal,timeoutMs=5000,late?:(value:Value)=>void):Promise<Value>{
 const scope=requestScope(signal,timeoutMs),pending=Promise.resolve().then(action);
 void pending.then(value=>{if(scope.signal.aborted){late?.(value);}},()=>{});
 try{return await abortable(pending,scope.signal);}
 catch(cause){checkSignal(signal);throw new ContentIOError("WORKSPACE_UNAVAILABLE",{cause});}
 finally{scope.dispose();}
}
export function createRequiredSink(factory:()=>Promise<MaterializeSinkV1>,signal:AbortSignal){
 return sinkOperation(factory,signal,5000,sink=>{void sink.abort(signal.aborted?"CANCELLED":"FAILED").catch(()=>{});});
}
