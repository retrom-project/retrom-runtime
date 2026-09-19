// @vitest-environment node
import {expect, it, vi} from "vitest";
import {iterateExact, readExact} from "./bounded-stream.js";
it("[IO-13] UNIT/transport preserves the first failure when cancel itself fails", async () => {
  const body = new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(new Uint8Array(2));}, cancel() {throw new Error("cancel failure");}});
  await expect(readExact(body, 1)).rejects.toThrow("CONTENT_IO_LENGTH_MISMATCH"); expect(body.locked).toBe(false);
});
it("[IO-20] UNIT/transport never aggregates a full response and cleans up when a consumer returns early", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(new Uint8Array(262144));}, cancel});
  for await (const chunk of iterateExact(body, 500000)) {expect(chunk.length).toBe(262144); break;}
  expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
});
it("[IO-21] UNIT/transport handles a null body only for an empty file", async () => {
  expect(await readExact(null, 0)).toHaveLength(0);
  await expect(readExact(null, 1)).rejects.toThrow("CONTENT_IO_LENGTH_MISMATCH");
});
