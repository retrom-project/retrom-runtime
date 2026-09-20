// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import type {WorkerBootV1} from "../../contracts/content-io/v1/content-io.js";
import {ContentSessionClient} from "./client.js";
import {ContentSessionService} from "./service.js";
import {BLOCK_BYTES as B} from "./source.js";

afterEach(() => {vi.unstubAllGlobals();});
it("[X-29] UNIT/session-diagnostics reports actual consumer bytes and a drained final snapshot before termination", async () => {
  const diagnostics = vi.fn();
  class LocalWorker extends EventTarget {
    service?: ContentSessionService;
    postMessage(boot: WorkerBootV1) {this.service = new ContentSessionService(boot);}
    terminate() {this.service?.close();}
  }
  vi.stubGlobal("Worker", LocalWorker);
  vi.stubGlobal("fetch", vi.fn(async () => {
    const response = new Response(new Uint8Array(2 * B), {status: 206,
      headers: {ETag: '"stable"', "Content-Length": String(2 * B), "Content-Range": `bytes 0-${2 * B - 1}/${8 * B}`}});
    Object.defineProperty(response, "url", {value: "https://example.test/data"}); return response;
  }));
  const session = new ContentSessionClient(new Worker("unused"), {storageOrigin: "https://example.test", allowedOrigins: ["https://example.test"]}, undefined, {onDiagnostic: diagnostics});
  try {
    const reader = await session.open({identity: {kind: "INDEX_ENTRY", projectDigest: "a".repeat(64), logicalPath: "private-name"},
      sizeBytes: 8 * B, url: "https://example.test/data?token=secret", purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"},
    {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: 8 * B, workspace: "NONE", writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
    await reader.readInto(7, new Uint8Array(13)); await reader.readInto(11, new Uint8Array(19));
    expect(reader.tryReadInto(15, new Uint8Array(23))).toBe(23);
    await reader.close(); await session.close();
    const final = diagnostics.mock.calls.at(-1)?.[0];
    expect(final).toMatchObject({sessionId: session.sessionId, operation: "CLOSE", codeNumber: 0, counts: {
      networkBytes: 2 * B, rangeRequests: 1, wholeRequests: 0, memoryHitBytes: 42, persistentHitBytes: 0,
      cacheBytesL1: 0, cacheBytesL2: 0, temporaryBytes: 0, outputCreditBytes: 0, syncBufferBytes: 0,
      inflight: 0, queued: 0, waiters: 0, channels: 0, leases: 0, peakCacheBytesL1: B, peakCacheBytesL2: 2 * B, peakChannels: 1,
    }});
    expect(JSON.stringify(diagnostics.mock.calls)).not.toMatch(/secret|private-name|https:/u);
    expect(fetch).toHaveBeenCalledOnce();
  } finally {await session.close();}
});
