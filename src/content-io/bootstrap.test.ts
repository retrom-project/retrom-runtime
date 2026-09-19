// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {bootstrapContentSession} from "./bootstrap.js";
import type {WorkerBootV1} from "../../contracts/content-io/v1/content-io.js";
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});
it("[X-16] UNIT/bootstrap-abort [BR-09] UNIT/bootstrap-abort aborting before READY terminates its Worker and releases its URL exactly once", async () => {
  let booted!: () => void; const started = new Promise<void>(resolve => {booted = resolve;});
  const terminate = vi.fn();
  class QuietWorker extends EventTarget {
    private port?: MessagePort;
    postMessage(boot: WorkerBootV1) {this.port = boot.managementPort; booted();}
    terminate() {terminate(); this.port?.close();}
  }
  vi.stubGlobal("Worker", QuietWorker);
  const bytes = new TextEncoder().encode("/* verified test worker */"), controller = new AbortController();
  const fetcher = vi.fn(async () => {const response = new Response(bytes); Object.defineProperty(response, "url", {value: "https://example.test/assets/content-io/worker.mjs"}); return response;});
  vi.stubGlobal("fetch", fetcher); const revoke = vi.spyOn(URL, "revokeObjectURL");
  const pending = bootstrapContentSession({runtimeBaseURL: "https://example.test/", storageOrigin: "https://example.test", allowedOrigins: ["https://example.test"],
    assetIndex: {"assets/content-io/worker.mjs": {sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")}}, signal: controller.signal});
  const rejection = expect(pending).rejects.toThrow("ABORTED");
  await started; controller.abort(); await rejection;
  expect(fetcher).toHaveBeenCalledOnce(); expect(terminate).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce();
});
