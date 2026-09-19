import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {contentSessionFixture} from "../../tests/content-session-fixture.js";
import {verifiedFetch} from "./fetch.js";
afterEach(() => vi.unstubAllGlobals());
it("[IO-13] UNIT/fantasy rejects short/long bodies and checksum changes through the public materializer", async () => {
  const bytes = new Uint8Array([1,2,3]), digest = createHash("sha256").update(bytes).digest("hex");
  for (const [size, hash, error] of [[4,digest,"LENGTH_MISMATCH"],[2,digest,"LENGTH_MISMATCH"],[3,"0".repeat(64),"CHECKSUM_MISMATCH"]] as const) {
    const owner = contentSessionFixture(location.origin);
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{const response=new Response(bytes,{headers:{ETag:`"sha256-${hash}"`}});Object.defineProperty(response,"url",{value:url});return response;}));
    try {await expect(verifiedFetch("/cart",size,hash,undefined,owner.session)).rejects.toThrow(error);}
    finally {await owner.close();}
  }
});
it("[IO-13] UNIT/fantasy cancels an overlong never-ending body without retaining its bytes",async()=>{
  const owner=contentSessionFixture(location.origin),cancel=vi.fn();
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4));},cancel});
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{const response=new Response(body,{headers:{ETag:`"sha256-${"0".repeat(64)}"`}});Object.defineProperty(response,"url",{value:url});return response;}));
  try {await expect(verifiedFetch("/cart",3,"0".repeat(64),undefined,owner.session)).rejects.toThrow("LENGTH_MISMATCH");expect(cancel).toHaveBeenCalledOnce();}
  finally {await owner.close();}
});
