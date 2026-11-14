import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import {expect, it, vi} from "vitest";

function fixture() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const replies: Array<{requestId: number; type: string}> = [];
  const keys = vi.fn(async () => [] as string[]), stop = vi.fn(), resume = vi.fn();
  const runtime = {
    location: {href: "https://runtime.example/game/index.html"},
    DataManager: {}, StorageManager: {}, localStorage,
    localforage: {keys, getItem: async () => null, setItem: async () => null, clear: async () => null},
    Utils: {RPGMAKER_NAME: "MZ"}, Scene_Boot: class {start() {}},
    SceneManager: {_scene: null, run() {}, updateMain() {}, stop, resume},
    document: {querySelectorAll: () => []},
    addEventListener(name: string, callback: (event: unknown) => void) {
      listeners.set(name, [...listeners.get(name) ?? [], callback]);
    },
    parent: {postMessage() {}}, requestAnimationFrame: () => 1,
  };
  const port = {onmessage: null as null | ((event: {data: unknown}) => void),
    postMessage: (value: {requestId: number; type: string}) => replies.push(value), start() {}};
  const identity = {launchId: "01980000-0000-7000-8000-000000000001", nonce: "test-nonce", protocolVersion: 1};
  runInNewContext(readFileSync(resolve(process.cwd(), "assets/runtime/native/bridge.js"), "utf8"),
    {URL, TextDecoder, TextEncoder, performance, window: runtime});
  listeners.get("message")?.[0]?.({data: {...identity, parentOrigin: "https://host.example", profile: "RPGMZ",
    type: "RPG_RUNTIME_NATIVE_CONNECT", saves: null, pluginFiles: []}, source: runtime.parent,
  origin: "https://host.example", ports: [port], stopImmediatePropagation() {}});
  listeners.get("load")?.forEach(listener => listener({target: runtime.document}));
  runtime.SceneManager.run();
  const send = (requestId: number, type: string) => port.onmessage?.({data: {...identity, requestId, type, body: {}}});
  return {send, keys, stop, resume, replies, update: () => runtime.SceneManager.updateMain()};
}

it.each([false, true])("recovers timed-out status polling and queues controls arriving while it is busy: early=%s", async early => {
  const f = fixture();
  await vi.waitFor(() => {
    f.update();
    expect(f.replies).toContainEqual(expect.objectContaining({type: "READY"}));
  });
  let release: (keys: string[]) => void = () => {};
  f.keys.mockImplementationOnce(() => new Promise<string[]>(resolve => {release = resolve;}));
  f.send(1, "STATUS");
  await vi.waitFor(() => expect(f.keys).toHaveBeenCalledTimes(2));
  // The caller's status deadline elapsed, so the next poll arrived while the old read was still pending.
  f.send(2, "STATUS");
  if (early) {f.send(3, "PAUSE");}
  release([]);
  await vi.waitFor(() => expect(f.replies).toContainEqual(expect.objectContaining({requestId: 1, type: "STATUS_RESULT"})));
  if (!early) {f.send(3, "PAUSE");}
  await vi.waitFor(() => expect(f.replies).toContainEqual(expect.objectContaining({requestId: 3, type: "PAUSE_RESULT"})));
  expect(f.stop).toHaveBeenCalledOnce();
  // Late retries and replays cannot apply an older command to the recovered channel.
  f.send(2, "RESUME"); f.send(3, "PAUSE");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.resume).not.toHaveBeenCalled();
  expect(f.stop).toHaveBeenCalledOnce();
  f.send(4, "RESUME");
  await vi.waitFor(() => expect(f.resume).toHaveBeenCalledOnce());
});

it("cleans up after a delayed status read without executing controls queued after cleanup", async () => {
  const f = fixture();
  await vi.waitFor(() => {f.update(); expect(f.replies).toContainEqual(expect.objectContaining({type: "READY"}));});
  let release: (keys: string[]) => void = () => {};
  f.keys.mockImplementationOnce(() => new Promise<string[]>(resolve => {release = resolve;}));
  f.send(1, "STATUS");
  await vi.waitFor(() => expect(f.keys).toHaveBeenCalledTimes(2));
  f.send(2, "CLEANUP"); f.send(3, "PAUSE");
  release([]);
  await vi.waitFor(() => expect(f.replies).toContainEqual(expect.objectContaining({requestId: 2, type: "CLEANUP_RESULT"})));
  expect(f.stop).not.toHaveBeenCalled();
  f.send(4, "PAUSE");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.stop).not.toHaveBeenCalled();
});
