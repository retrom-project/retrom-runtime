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
it("validates EOF before handing the final block to an asynchronous consumer", async () => {
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({pull(controller) {
    if (++reads === 1) {controller.enqueue(Uint8Array.of(1, 2, 3));} else {controller.close();}
  }}, {highWaterMark: 0});
  const stream = iterateExact(body, 3);
  try {
    expect((await stream.next()).value).toEqual(Uint8Array.of(1, 2, 3));
    expect(reads).toBe(2);
  } finally {await stream.return(undefined);}
});
it("rejects trailing bytes before exposing the final declared block", async () => {
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({pull(controller) {
    controller.enqueue(++reads === 1 ? Uint8Array.of(1, 2, 3) : Uint8Array.of(4));
  }}, {highWaterMark: 0});
  const stream = iterateExact(body, 3);
  try {await expect(stream.next()).rejects.toThrow("CONTENT_IO_LENGTH_MISMATCH");}
  finally {await stream.return(undefined);}
});
it("drains EOF before splitting a final network chunk into cache blocks", async () => {
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({pull(controller) {
    if (++reads === 1) {controller.enqueue(new Uint8Array(300000));} else {controller.close();}
  }}, {highWaterMark: 0});
  const stream = iterateExact(body, 300000);
  try {
    expect((await stream.next()).value).toHaveLength(262144);
    expect(reads).toBe(2);
    expect((await stream.next()).value).toHaveLength(37856);
    expect((await stream.next()).done).toBe(true);
  } finally {await stream.return(undefined);}
});
