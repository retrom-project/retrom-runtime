// @vitest-environment node
import {expect, it, vi} from "vitest";
import {windowBody} from "./window-body.js";
import {MAX_FETCH_BYTES, OUTPUT_BYTES, TEMPORARY_BYTES, CACHE_WRITE_BYTES, windowScratchBytes} from "./fetch-policy.js";
import {BufferCredits} from "./credits.js";
import {iterateExact} from "./bounded-stream.js";

it("rejects an unbounded response before creating a native tee", () => {
  const response = new Response("game"), clone = vi.spyOn(response, "clone");
  expect(() => windowBody(response, MAX_FETCH_BYTES + 1)).toThrow("CONTENT_IO_BOUNDS");
  expect(clone).not.toHaveBeenCalled();
});
it("cancels the source once when a bounded response overflows its declared window", async () => {
  const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({
    start(controller) {controller.enqueue(Uint8Array.of(1, 2));}, cancel,
  });
  const response = new Response(body);
  await expect((async () => {for await (const bytes of iterateExact(windowBody(response, 1), 1)) void bytes;})())
    .rejects.toThrow("CONTENT_IO_LENGTH_MISMATCH");
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});
it("keeps streaming without a native tee when the wire length is absent or encoded", () => {
  const representations: Record<string, string>[] = [{}, {"Content-Encoding": "gzip", "Content-Length": "1"}];
  for (const headers of representations) {
    const response = new Response(Uint8Array.of(1), {headers}), clone = vi.spyOn(response, "clone");
    expect(windowBody(response, 1)).toBe(response.body);
    expect(clone).not.toHaveBeenCalled();
  }
});
it("makes progress at the maximum window with output and optional-write credits saturated", async () => {
  const credits = new BufferCredits();
  const output = await credits.reserve(OUTPUT_BYTES, "OUTPUT"), write = await credits.reserve(CACHE_WRITE_BYTES, "CACHE_WRITE");
  const scratch = await credits.reserve(windowScratchBytes(MAX_FETCH_BYTES), "SCRATCH");
  expect(MAX_FETCH_BYTES).toBe(2 * 1024 * 1024);
  expect(credits.stats).toMatchObject({temporaryBytes: TEMPORARY_BYTES, waiting: 0});
  scratch(); write(); output();
  expect(credits.stats).toMatchObject({temporaryBytes: 0, outputBytes: 0, cacheWriteBytes: 0, waiting: 0});
});
