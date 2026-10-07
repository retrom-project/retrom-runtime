import {afterEach, expect, it, vi} from "vitest";
import {NativeChannel, mountNativeRpg} from "./adapter.js";
import {NativeContentActivity, nativeReadyDeadline} from "./startup-timeout.js";

const channels: NativeChannel[] = [];
afterEach(() => {for (const channel of channels) channel.close(); channels.length = 0; vi.useRealTimers();});
function fixture(initialLoading = false) {
  vi.useFakeTimers();
  const channel = new NativeChannel({sessionId: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3", bridgeProfile: "RPGMZ",
    uniqueOrigin: "https://runtime.test"}, () => {});
  channels.push(channel);
  let notify: (busy: boolean) => void = () => {};
  const unsubscribe = vi.fn(), controller = new AbortController();
  const loading = {subscribe(listener: (busy: boolean) => void) {notify = listener; listener(initialLoading); return unsubscribe;}};
  let failure: string | undefined;
  const ready = channel.ready({loading, signal: controller.signal}).catch((error: Error) => {failure = error.name === "AbortError" ? error.name : error.message;});
  return {channel, ready, controller, unsubscribe, loading: (busy: boolean) => notify(busy), failure: () => failure};
}
it("does not expire a native startup while game content is still being read", async () => {
  const state = fixture(true);
  await vi.advanceTimersByTimeAsync(45_000);
  expect(state.failure()).toBeUndefined();
  state.loading(false);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(state.failure()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  await state.ready;
  expect(state.failure()).toBe("RPG_RUNTIME_TIMEOUT");
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});
it("gives the engine a bounded idle window and renews it when another read starts", async () => {
  const state = fixture();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(state.failure()).toBeUndefined();
  state.loading(true);
  await vi.advanceTimersByTimeAsync(20_000);
  state.loading(false);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(state.failure()).toBe("RPG_RUNTIME_TIMEOUT");
});
it("aborts a pending native startup immediately and releases the loading subscription", async () => {
  const state = fixture(true);
  state.controller.abort();
  await state.ready;
  expect(state.failure()).toBe("AbortError");
  expect(state.unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("releases the loading subscription when a pending channel is closed", async () => {
  const state = fixture(true);
  state.channel.close();
  await state.ready;
  expect(state.failure()).toBe("RPG_NATIVE_CHANNEL_CLOSED");
  expect(state.unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("stops observing loading when the exact connected engine reports READY", async () => {
  const state = fixture(true);
  let port: MessagePort | undefined;
  state.channel.connect({postMessage: (message: Record<string, unknown>, _origin: string, transfer: Transferable[]) => {
    port = transfer[0] as MessagePort;
    port.postMessage({protocolVersion: 1, launchId: message.launchId, nonce: message.nonce, requestId: 0,
      type: "READY", body: {engine: "RPGMZ", engineProfile: "RPGMZ"}});
  }} as unknown as Window);
  try {
    await vi.waitFor(() => expect(state.unsubscribe).toHaveBeenCalledOnce());
    await state.ready;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.failure()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  } finally {port?.close();}
});
it("preserves a read failure when the Host immediately aborts startup after FATAL_ERROR", async () => {
  const state = fixture();
  await state.channel.close();
  const channel = new NativeChannel({sessionId: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3", bridgeProfile: "RPGMZ",
    uniqueOrigin: "https://runtime.test"}, () => {});
  channels.push(channel);
  const loading = new NativeContentActivity(), controller = new AbortController();
  const failure = new Error("CONTENT_IO_TIMEOUT");
  const ready = channel.ready({loading, signal: controller.signal});
  const rejected = expect(ready).rejects.toBe(failure);
  loading.fail(failure); controller.abort();
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
it("releases an already failed loading subscription without waiting for an engine deadline", async () => {
  vi.useFakeTimers();
  const loading = new NativeContentActivity(), failure = new Error("CONTENT_IO_LENGTH_MISMATCH");
  loading.fail(failure);
  const subscribe = loading.subscribe.bind(loading), remove = vi.fn(), rejected = vi.fn();
  vi.spyOn(loading, "subscribe").mockImplementation(listener => {
    const unsubscribe = subscribe(listener);
    return () => {remove(); unsubscribe();};
  });
  nativeReadyDeadline({loading}, rejected);
  expect(rejected).toHaveBeenCalledWith(failure);
  expect(remove).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("immediately cancels the bootstrap handshake and releases its timers", async () => {
  vi.useFakeTimers();
  const frame = document.createElement("iframe"); document.body.append(frame);
  const controller = new AbortController();
  const mounted = mountNativeRpg({sessionId: "018f0f31-26fe-7a31-9d61-4ec92f16d4c3", bridgeProfile: "RPGMZ",
    uniqueOrigin: "https://runtime.test"},
  frame, null, undefined, {signal: controller.signal});
  const rejected = expect(mounted).rejects.toMatchObject({name: "AbortError"});
  controller.abort();
  try {
    await rejected;
    expect(frame.src).toBe("about:blank");
    expect(vi.getTimerCount()).toBe(0);
  } finally {frame.remove();}
});
