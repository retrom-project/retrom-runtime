import {expect,it,vi} from "vitest";
import {hostObject} from "./bridge/schema.js";
import {createSyncBuffer,closeSyncBuffer,checkSlot,controls} from "./bridge/blocking.js";
import {defineTarget} from "../provider/declarations.js";
import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
import {stopNativeInstance} from "../providers/emulatorjs/native-exit.js";
it("[BR-10] CONTRACT/File is a valid structured-clone Blob result",()=>{expect(hostObject(new File([new Uint8Array(1)],"result"),"Blob")).toBe(true);});
it("[BR-07] UNIT/sync preserves the first permanent close cause",()=>{const buffer=createSyncBuffer(1);closeSyncBuffer(buffer,5);closeSyncBuffer(buffer,11);expect(()=>checkSlot(controls(buffer),1)).toThrow("CONTENT_IO_IDENTITY_CHANGED");});
it("[PK-01] CONTRACT/declaration owns a frozen policy copy",()=>{
 const target=retromRuntimeProviderDefinition.targets.find(target=>target.id==="wasm4")!;
 const policy={...target.contentIO.game}, input={...target,contentIO:{...target.contentIO,game:policy}};
 const result=defineTarget(input);expect(result.contentIO).not.toBe(input.contentIO);
 expect(Object.isFrozen(result.contentIO)).toBe(true);expect(Object.isFrozen(result.contentIO.game)).toBe(true);
});
it("[X-11] UNIT/native teardown cannot wait forever on a pending read",async()=>{
 vi.useFakeTimers();try{const callEvent=vi.fn();const stopped=stopNativeInstance(window,{callEvent},"neocd",false,{idle:()=>new Promise(()=>{})});
 await vi.advanceTimersByTimeAsync(2200);await stopped;expect(callEvent).toHaveBeenCalledWith("exit");}finally{vi.useRealTimers();}
});
it("[PK-01] CONTRACT/managed targets declare the executable Content I/O closure",()=>{
 for(const target of retromRuntimeProviderDefinition.targets){
  const policies=Object.values(target.contentIO),managed=policies.some(p=>"bridge" in p);
  expect((target.assetPaths as readonly string[]).includes("assets/content-io/worker.mjs")).toBe(managed);
  expect((target.assetPaths as readonly string[]).includes("assets/content-io/sync-client.mjs")).toBe(policies.some(p=>"bridge" in p&&p.bridge==="SYNC_WORKER"));
 }
});
