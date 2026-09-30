// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {mountEKA2L1} from "./adapter.js";
import type {BrowserSession, SessionLoader, EKA2L1Parameters} from "./core.js";
const parameters={rotation:0,confirmKey:"ENTER",uid:0} as EKA2L1Parameters;
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{await Promise.all(cleanups.splice(0).map(cleanup=>cleanup()));document.body.replaceChildren();vi.restoreAllMocks();});
function fixture(){
  const order:string[]=[],native=new Uint8Array([69,75,65,50]);let available=false,dirty=false,generation=0;
  const session:BrowserSession={
    start:vi.fn(async()=>{order.push("start");}),stop:vi.fn(async()=>{order.push("stop");}),
    importSave:vi.fn(async bytes=>{expect(bytes).toEqual(native);order.push("restore");available=true;}),
    exportSave:vi.fn(async()=>native),acknowledgeSave:vi.fn(async()=>{dirty=false;}),
    saveAvailable:()=>available,saveDirty:()=>dirty,frames:()=>23,
    journal:{get generation(){return generation;}},
    pause:vi.fn(async()=>{}),resume:vi.fn(async()=>{}),key:vi.fn(),reply:vi.fn(),setRotation:vi.fn(),
  };
  const loader:SessionLoader=vi.fn(async()=>session),target=document.createElement("div");document.body.append(target);
  return {session,loader,target,native,order,write(){available=true;dirty=true;generation++;}};
}
describe("Symbian native save lifecycle",()=>{
  it("reports every native write revision while a previous save remains unacknowledged",async()=>{
    const f=fixture(),adapter=await mountEKA2L1(parameters,f.target,window,null,vi.fn(),undefined,f.loader);cleanups.push(adapter.exit);
    f.write();expect(adapter.getCheckpointAvailability()).toMatchObject({available:true,revision:"1"});
    await adapter.checkpoint();
    expect(adapter.getCheckpointAvailability()).toMatchObject({available:true,revision:"1"});
    f.write();expect(adapter.getCheckpointAvailability()).toMatchObject({available:true,revision:"2"});
  });
  it("imports before application start and acknowledges only successful persistence",async()=>{
    const f=fixture(),adapter=await mountEKA2L1(parameters,f.target,window,f.native,vi.fn(),undefined,f.loader);cleanups.push(adapter.exit);
    expect(f.order).toEqual(["restore","start"]);
    expect(adapter.getCheckpointAvailability()).toMatchObject({available:false,blocker:"UNCHANGED"});
    f.write();const checkpoint=await adapter.checkpoint();
    expect(checkpoint).toEqual({format:"eka2l1-game-save-v1",bytes:f.native});
    expect(f.session.acknowledgeSave).not.toHaveBeenCalled();
    expect(adapter.getCheckpointAvailability().available).toBe(true);
    await adapter.acknowledgeCheckpoint!(checkpoint);
    expect(adapter.getCheckpointAvailability()).toMatchObject({available:false,blocker:"UNCHANGED"});
  });
  it("blocks capture without native writes and never claims an instant restore",async()=>{
    const f=fixture(),adapter=await mountEKA2L1(parameters,f.target,window,null,vi.fn(),undefined,f.loader);cleanups.push(adapter.exit);
    expect(adapter.getCheckpointAvailability()).toMatchObject({available:false,blocker:"NO_SAVE",save:{dataKind:"STORAGE",capture:"IN_GAME",restore:"IN_GAME",captureAvailable:false}});
    await expect(adapter.checkpoint()).rejects.toThrow("EKA2L1_NO_NATIVE_SAVE");expect(f.session.exportSave).not.toHaveBeenCalled();
  });
  it("failed restore stops the instance instead of starting a new game",async()=>{
    const f=fixture();vi.mocked(f.session.importSave).mockRejectedValue(new Error("damaged"));
    await expect(mountEKA2L1(parameters,f.target,window,f.native,vi.fn(),undefined,f.loader)).rejects.toThrow("damaged");
    expect(f.session.start).not.toHaveBeenCalled();expect(f.session.stop).toHaveBeenCalledOnce();expect(f.target.querySelector("canvas")).toBeNull();
  });
  it("cancellation during restore never starts the application",async()=>{
    const f=fixture(),controller=new AbortController();
    vi.mocked(f.session.importSave).mockImplementation(async()=>{controller.abort();});
    await expect(mountEKA2L1(parameters,f.target,window,f.native,vi.fn(),controller.signal,f.loader)).rejects.toThrow();
    expect(f.session.start).not.toHaveBeenCalled();expect(f.session.stop).toHaveBeenCalledOnce();
  });
  it("pause, rotation and exit release held input; exit is idempotent",async()=>{
    const f=fixture(),adapter=await mountEKA2L1(parameters,f.target,window,null,vi.fn(),undefined,f.loader);cleanups.push(adapter.exit);
    await adapter.pause();expect(f.session.pause).toHaveBeenCalledOnce();await adapter.resume();expect(f.session.resume).toHaveBeenCalledOnce();
    (f.target.querySelector("button") as HTMLButtonElement).click();expect(f.session.setRotation).toHaveBeenCalledWith(90);
    await adapter.exit();await adapter.exit();expect(f.session.stop).toHaveBeenCalledOnce();expect(adapter.getFrameCount()).toBeNull();
    expect(adapter.getCheckpointAvailability()).toMatchObject({available:false,blocker:"NOT_READY"});
  });
});
