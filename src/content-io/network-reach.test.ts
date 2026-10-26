// @vitest-environment node
import {afterEach, expect, it, vi} from "vitest";
import type {WorkerBootV1} from "../../contracts/content-io/v1/content-io.js";
import {BlockPool} from "./block-pool.js";
import {ContentSessionClient} from "./client.js";
import {fetchRangeBlock, stalledResponseMs} from "./http.js";
import type {ContentNetworkState} from "./network-wait.js";
import {ContentSessionService} from "./service.js";
import {BLOCK_BYTES as B} from "./source.js";

afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
const source = {identity: {kind: "INDEX_ENTRY", projectDigest: "a".repeat(64), logicalPath: "data"}, sizeBytes: 8 * B,
  url: "https://example.test/data", purpose: "GAME", transport: "RANGE_REQUIRED", etagPolicy: "PIN_STRONG", contentLengthPolicy: "EXACT_IF_PRESENT"} as const;
function partial(start: number, end = start + B - 1): Response {
  const response = new Response(new Uint8Array(end - start + 1).fill(5), {status: 206,
    headers: {ETag: '"stable"', "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${8 * B}`}});
  Object.defineProperty(response, "url", {value: source.url}); return response;
}
const state = () => ({pinnedEtag: null, generation: "g1", revoked: false});

it("[NET-10] UNIT/a demanded read reports the outage on its first failed request, before its own deadline", async () => {
  class LocalWorker extends EventTarget {
    service?: ContentSessionService;
    postMessage(boot: WorkerBootV1) {this.service = new ContentSessionService(boot);}
    terminate() {this.service?.close();}
  }
  vi.stubGlobal("Worker", LocalWorker);
  const states: ContentNetworkState[] = [];
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    if (calls++ === 0) {throw new TypeError("Failed to fetch");}
    expect(states).toEqual(["WAITING"]);
    const [, start, end] = /bytes=(\d+)-(\d+)/u.exec(new Headers(init.headers).get("Range")!)!;
    return partial(Number(start), Number(end));
  }));
  const session = new ContentSessionClient(new Worker("unused"), {storageOrigin: "https://example.test", allowedOrigins: ["https://example.test"]},
    undefined, {onNetwork: state => states.push(state), fetchPolicy: {smallFileThresholdBytes: 0, networkWindowBytes: 2 * B}});
  try {
    const reader = await session.open(source, {mode: "RANGE", bridge: "ASYNC", result: "READER", maxFileBytes: 8 * B, workspace: "NONE",
      writes: "DENY", contentLengthPolicy: "EXACT_IF_PRESENT"});
    await expect(reader.readInto(0, new Uint8Array(10))).resolves.toBe(10);
    await vi.waitFor(() => expect(states).toEqual(["WAITING", "RESTORED"]));
  } finally {await session.close();}
});

it("[NET-11] UNIT/requests report unreachable on failure or a stalled response, and reachable on any response", async () => {
  vi.useFakeTimers();
  const reachable = vi.fn<(value: boolean) => void>();
  let respond!: (response: Response) => void;
  const stalled = fetchRangeBlock(source, state(), 0, undefined, 15000, {reachable,
    fetch: vi.fn(() => new Promise<Response>(resolve => {respond = resolve;}))});
  await vi.advanceTimersByTimeAsync(stalledResponseMs - 1); expect(reachable).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(reachable.mock.calls).toEqual([[false]]);
  respond(partial(0)); await expect(stalled).resolves.toHaveLength(B);
  expect(reachable.mock.calls).toEqual([[false], [true]]);
  reachable.mockClear();
  let calls = 0;
  const failing = fetchRangeBlock(source, state(), 0, undefined, 15000, {reachable,
    fetch: vi.fn(async () => {if (calls++ === 0) {throw new TypeError("Failed to fetch");} return partial(0);})});
  await vi.advanceTimersByTimeAsync(1000); await expect(failing).resolves.toHaveLength(B);
  expect(reachable.mock.calls).toEqual([[false], [true]]);
});

it("[NET-12] UNIT/only a waiting consumer marks an object as demanded, not speculative loads", async () => {
  let release!: () => void;
  const pool = new BlockPool(0, async () => {await new Promise<void>(resolve => {release = resolve;}); return new Uint8Array(B);});
  const object = {key: "game", state: state(), source};
  try {
    expect(pool.demanding("game")).toBe(false);
    const reading = pool.copy(object, 0, 0, new Uint8Array(4), () => {});
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(pool.demanding("game")).toBe(true); expect(pool.demanding("other")).toBe(false);
    release(); await reading;
    expect(pool.demanding("game")).toBe(false);
  } finally {pool.close();}
});
