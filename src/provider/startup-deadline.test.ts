import {afterEach, expect, it, vi} from "vitest";
import {StartupDeadline} from "./startup-deadline.js";
import {observeStartupNetwork} from "./startup-network.js";

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});

it("allows increasing bytes indefinitely but keeps every stalled request bounded", async () => {
  vi.useFakeTimers();
  const fail = vi.fn(), deadline = new StartupDeadline(window, new AbortController().signal, fail, 30_000);
  deadline.initialize(); const active = deadline.transfer(), stalled = deadline.transfer();
  await vi.advanceTimersByTimeAsync(20_000); active.progress(10);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({code: "PLAYER_RESOURCE_IDLE_TIMEOUT"}));
  stalled.complete(); expect(vi.getTimerCount()).toBe(0);
});

it("does not extend the idle limit for repeated or decreasing counters", async () => {
  vi.useFakeTimers();
  const fail = vi.fn(), deadline = new StartupDeadline(window, new AbortController().signal, fail, 30_000);
  const transfer = deadline.transfer(); transfer.progress(10);
  await vi.advanceTimersByTimeAsync(20_000); transfer.progress(10); transfer.progress(9);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fail).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("starts a fresh initialization limit only after all transfers finish", async () => {
  vi.useFakeTimers();
  const fail = vi.fn(), deadline = new StartupDeadline(window, new AbortController().signal, fail, 120_000);
  deadline.initialize(); const transfer = deadline.transfer();
  for (let index = 1; index <= 8; index++) {await vi.advanceTimersByTimeAsync(20_000); transfer.progress(index);}
  expect(fail).not.toHaveBeenCalled(); transfer.complete();
  await vi.advanceTimersByTimeAsync(119_999); expect(fail).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({code: "PLAYER_CORE_INITIALIZATION_TIMEOUT"}));
});

it("clears both stages and aborts pending requests on cancellation", async () => {
  vi.useFakeTimers();
  const signal = new AbortController(), fail = vi.fn();
  const deadline = new StartupDeadline(window, signal.signal, fail, 30_000);
  vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => {});
  const cleanup = observeStartupNetwork(window, deadline);
  const xhr = new XMLHttpRequest(), abort = vi.spyOn(xhr, "abort"); xhr.open("GET", "/core"); xhr.send();
  signal.abort(); cleanup(true); await vi.advanceTimersByTimeAsync(60_000);
  expect(abort).toHaveBeenCalledOnce(); expect(fail).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it("observes unknown-length fetch streams without losing response identity", async () => {
  vi.useFakeTimers();
  const fail = vi.fn(), deadline = new StartupDeadline(window, new AbortController().signal, fail, 30_000);
  let push: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({start(controller) {push = controller;}});
  const response = new Response(body); Object.defineProperty(response, "url", {value: "https://runtime.test/core.wasm"});
  vi.spyOn(window, "fetch").mockResolvedValue(response);
  const cleanup = observeStartupNetwork(window, deadline);
  const observed = await window.fetch("https://runtime.test/core.wasm");
  const bytes = observed.arrayBuffer();
  for (let index = 0; index < 4; index++) {
    await vi.advanceTimersByTimeAsync(20_000); push?.enqueue(new Uint8Array([index])); await vi.advanceTimersByTimeAsync(0);
  }
  expect(fail).not.toHaveBeenCalled(); expect(observed.url).toBe(response.url);
  push?.close(); expect(new Uint8Array(await bytes)).toEqual(new Uint8Array([0, 1, 2, 3]));
  deadline.stop(); cleanup(false); expect(vi.getTimerCount()).toBe(0);
});

it("preserves an optional HTTP failure for the upstream loader's fallback", async () => {
  const fail = vi.fn(), deadline = new StartupDeadline(window, new AbortController().signal, fail, 30_000);
  const response = new Response("missing optional locale", {status: 404});
  vi.spyOn(window, "fetch").mockResolvedValue(response);
  const cleanup = observeStartupNetwork(window, deadline);
  expect(await window.fetch("/locales/optional.json")).toBe(response);
  expect(fail).not.toHaveBeenCalled(); deadline.stop(); cleanup(false);
});
