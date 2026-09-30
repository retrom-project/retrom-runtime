import {describe, expect, it, vi} from "vitest";
import {prepareInputs} from "./content.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";
import {eagerPolicy} from "../provider/content-policies.js";
const file=(path:string)=>({path,url:`https://games.example/${path}`,sha256:"a".repeat(64),sizeBytes:3});
const config={game:file("game.sis"),firmware:[file("Nokia5320.rpkg"),file("Nokia5320.rom")]};
function fixture(){
  const close=vi.fn(async()=>{}),open=vi.fn(async()=>({id:"reader",close}));
  const materialize=vi.fn(async()=>({kind:"BYTES" as const,bytes:new Uint8Array([1,2,3])}));
  const session={open,materialize,closeFile:close,inputPolicy:vi.fn(()=>eagerPolicy(512*1024*1024))} as unknown as AdapterContentSession;
  return {session,open,close,materialize};
}
describe("Symbian Content I/O",()=>{
  it("materializes SIS and both firmware files through their managed roles and closes readers",async()=>{
    const f=fixture(),result=await prepareInputs(config,f.session);
    expect(result.sis).toEqual(new Uint8Array([1,2,3]));
    expect(f.open.mock.calls.map(call=>(call as unknown as [{purpose:string}])[0].purpose)).toEqual(["GAME","FIRMWARE","FIRMWARE"]);
    expect(f.session.inputPolicy).toHaveBeenNthCalledWith(1,"game");
    expect(f.session.inputPolicy).toHaveBeenNthCalledWith(2,"external");
    expect(f.close).toHaveBeenCalledTimes(3);
  });
  it("rejects missing, duplicate or unrelated firmware before loading game bytes",async()=>{
    for(const firmware of [[],[file("Nokia5320.rom")],[file("Nokia5320.rom"),file("Nokia5320.rom")],[file("other.rom"),file("other.rpkg")]]){
      const f=fixture();await expect(prepareInputs({...config,firmware},f.session)).rejects.toThrow("EKA2L1_FIRMWARE_INVALID");expect(f.open).not.toHaveBeenCalled();
    }
  });
  it("closes a failed reader and propagates cancellation without a network fallback",async()=>{
    const f=fixture();f.materialize.mockRejectedValueOnce(new Error("cancelled"));
    await expect(prepareInputs(config,f.session)).rejects.toThrow("cancelled");expect(f.close).toHaveBeenCalledOnce();
  });
});
