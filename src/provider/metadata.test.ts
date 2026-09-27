import {afterEach,expect,it,vi} from "vitest";
import {boundedJson,fetchMetadataJson,indexByteBudget} from "./metadata.js";
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
it("[X-28] UNIT/metadata uses the original file/path limits with JSON and URL expansion",()=>{
 expect(indexByteBudget(100_000,1024)).toBe(65536+100_000*(18*1024+8192));
 expect(indexByteBudget(10_000,1024)).toBe(65536+10_000*(18*1024+8192));
 expect(indexByteBudget(1,1)).toBe(16*1024*1024);
});
it("uses the shared redirect policy and cancels a stalled metadata body", async () => {
 vi.useFakeTimers();
 const cancel = vi.fn(), fetcher = vi.fn(async () => new Response(new ReadableStream({cancel})));
 vi.stubGlobal("fetch", fetcher);
 const pending = expect(fetchMetadataJson("https://host/index", 1024)).rejects.toThrow("CONTENT_IO_TIMEOUT");
 await vi.advanceTimersByTimeAsync(20_001); await pending;
 expect(fetcher).toHaveBeenCalledWith("https://host/index", expect.objectContaining({redirect: "error", credentials: "same-origin"}));
 expect(cancel).toHaveBeenCalledOnce();
});
it("[X-28] UNIT/metadata counts UTF-8 bytes and cancels oversized streams before JSON parsing",async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({path:"雪😀"}));expect(await boundedJson(new Response(bytes),bytes.length)).toEqual({path:"雪😀"});
 const cancel=vi.fn(),stream=new ReadableStream({start(c){c.enqueue(bytes);},cancel});
 await expect(boundedJson(new Response(stream),bytes.length-1)).rejects.toThrow("METADATA_SIZE_INVALID");expect(cancel).toHaveBeenCalledOnce();
 await expect(boundedJson(new Response(new Uint8Array([0xff])),8)).rejects.toThrow();
});
