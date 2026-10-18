import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {afterEach, describe, expect, it, vi} from "vitest";

afterEach(() => {document.body.replaceChildren();});

function bridge(nativePlay = vi.fn((): Promise<void> => Promise.resolve())) {
  let now = 0, requestId = 0;
  const listeners = new Map<string, (event: unknown) => void>();
  const intervals = new Set<() => void>();
  const replies: {requestId: number; type: string}[] = [];
  class Media extends EventTarget {
    tagName = "AUDIO";
    paused = false;
    muted = false;
    play() {return nativePlay();}
    pause() {this.paused = true;}
  }
  const native = Media.prototype.play;
  const kag = {
    tmp: {ready_audio: true}, event: {}, layer: {}, config: {},
    ftag: {array_tag: [{name: "s"}], current_order_index: 0},
    key_mouse: {util: {canShowMenu: () => true}},
    menu: {snapSave() {}, loadGameData() {}},
    stat: {f: {}, current_scenario: "first.ks"},
  };
  const parent = {postMessage() {}};
  const port = {onmessage: null as null | ((event: {data: unknown}) => void),
    postMessage: (reply: {requestId: number; type: string}) => replies.push(reply), start() {}, close() {}};
  const global = {
    document, parent, TYRANO: {kag}, Event: window.Event, HTMLMediaElement: Media,
    navigator: {userActivation: {isActive: true, hasBeenActive: true}},
    performance: {now: () => now}, getComputedStyle: window.getComputedStyle.bind(window),
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    removeEventListener() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setInterval: (callback: () => void) => {intervals.add(callback); return callback;},
    clearInterval: (callback: () => void) => intervals.delete(callback),
  };
  runInNewContext(readFileSync("assets/runtime/tyranoscript/bridge.js", "utf8"), {window: global, TextEncoder, TextDecoder});
  const identity = {sessionId: "session", nonce: "abcdefghijklmnop", protocolVersion: 1};
  listeners.get("message")?.({source: parent, origin: "https://host.example", ports: [port],
    data: {...identity, parentOrigin: "https://host.example", type: "GAME_RUNTIME_TYRANOSCRIPT_CONNECT"}});
  return {
    Media, native, global,
    tick(time: number) {now = time; intervals.forEach(callback => callback());},
    async request(type: string) {
      const id = ++requestId;
      port.onmessage?.({data: {...identity, requestId: id, type, body: {}}});
      await vi.waitFor(() => expect(replies.find(reply => reply.requestId === id)).toBeDefined());
      expect(replies.find(reply => reply.requestId === id)?.type).toBe(type + "_RESULT");
    },
  };
}

function animation(options: {state?: string; duration?: number; startTime?: number | null;
  currentTime?: number; progress?: number | null} = {}) {
  return {playState: options.state ?? "finished", startTime: options.startTime === undefined ? 0 : options.startTime,
    currentTime: options.currentTime ?? 0, effect: {getComputedTiming: () => ({duration: options.duration ?? 0,
      activeDuration: options.duration ?? 0, endTime: options.duration ?? 0, progress: options.progress === undefined ? 1 : options.progress})}};
}

function layer(initial = animation(), removeClass = true) {
  let current = initial;
  const element = document.createElement("div"); element.className = "animated fadeIn";
  const completed = vi.fn(() => {if (removeClass) element.classList.remove("animated", "fadeIn");});
  element.addEventListener("animationend", completed);
  Object.defineProperty(element, "getAnimations", {value: () => [current]});
  document.body.append(element);
  return {element, completed, replace(next: typeof initial) {current = next;}};
}

describe("Tyrano transition completion", () => {
  it("unblocks a zero-duration transition whose native completion event was lost", () => {
    const l = layer(), runtime = bridge();
    runtime.tick(249); expect(l.completed).not.toHaveBeenCalled();
    runtime.tick(250); expect(l.completed).toHaveBeenCalledOnce();
    runtime.tick(1000); expect(l.completed).toHaveBeenCalledOnce();
  });

  it("does not repeat completion even if the game retains its animation class", () => {
    const l = layer(animation(), false), runtime = bridge();
    runtime.tick(250); runtime.tick(251); runtime.tick(1000);
    expect(l.completed).toHaveBeenCalledOnce();
  });

  it("does not duplicate a natural completion event", () => {
    const l = layer(), runtime = bridge();
    l.element.dispatchEvent(new window.Event("animationend"));
    runtime.tick(1000); expect(l.completed).toHaveBeenCalledOnce();
  });

  it("restarts observation when the animation on a layer is replaced", () => {
    const l = layer(), runtime = bridge();
    runtime.tick(200); l.replace(animation()); runtime.tick(250);
    expect(l.completed).not.toHaveBeenCalled();
    runtime.tick(499); expect(l.completed).not.toHaveBeenCalled();
    runtime.tick(500); expect(l.completed).toHaveBeenCalledOnce();
  });

  it("preserves the existing recovery for an animation that never starts", () => {
    const l = layer(animation({state: "running", startTime: null, duration: 500})), runtime = bridge();
    runtime.tick(749); expect(l.completed).not.toHaveBeenCalled();
    runtime.tick(750); expect(l.completed).toHaveBeenCalledOnce();
  });

  it.each([
    {state: "running", startTime: 0, currentTime: 100, duration: 500},
    {state: "paused", startTime: null, duration: 0},
    {state: "idle", startTime: null, duration: 0},
    {state: "finished", duration: 500},
    {state: "finished", duration: 0, progress: null},
    {state: "finished", duration: Infinity},
  ])("leaves other animation states alone: %j", options => {
    const l = layer(animation(options)), runtime = bridge();
    runtime.tick(10000); expect(l.completed).not.toHaveBeenCalled();
  });

  it("does not advance while paused, then rechecks the transition after resume", async () => {
    const l = layer(), runtime = bridge();
    await runtime.request("PAUSE"); runtime.tick(1000);
    expect(l.completed).not.toHaveBeenCalled();
    await runtime.request("RESUME"); runtime.tick(1001); runtime.tick(1251);
    expect(l.completed).toHaveBeenCalledOnce();
  });

  it("does not finish removed layers or exited sessions", async () => {
    const removed = layer(), runtime = bridge(); removed.element.remove();
    runtime.tick(1000); expect(removed.completed).not.toHaveBeenCalled();
    const live = layer(); runtime.tick(1001); await runtime.request("CLEANUP"); runtime.tick(2000);
    expect(live.completed).not.toHaveBeenCalled();
  });
});

function deferred() {
  let reject!: (error: Error) => void;
  let resolve!: () => void;
  const promise = new Promise<void>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

describe("legacy media cancellation", () => {
  it("settles an obsolete play cancellation after the same media has resumed", async () => {
    const first = deferred(), second = deferred();
    const runtime = bridge(vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const media = new runtime.Media(), oldPlay = media.play();
    media.pause(); media.paused = false;
    const newPlay = media.play();
    const result = expect(oldPlay).resolves.toBeUndefined();
    first.reject(new DOMException("Replaced by a new load request", "AbortError"));
    second.resolve(); await result; await newPlay;
  });

  it("still settles a cancellation while the current media is paused", async () => {
    const pending = deferred(), runtime = bridge(vi.fn(() => pending.promise));
    const media = new runtime.Media(), playing = media.play(); media.pause();
    const result = expect(playing).resolves.toBeUndefined();
    pending.reject(new DOMException("Paused", "AbortError")); await result;
  });

  it.each(["AbortError", "NotSupportedError", "NetworkError"])("preserves a live playback failure: %s", async name => {
    const pending = deferred(), runtime = bridge(vi.fn(() => pending.promise));
    const playing = new runtime.Media().play(), error = new DOMException("Actual failure", name);
    const result = expect(playing).rejects.toBe(error); pending.reject(error); await result;
  });

  it("does not hide an obsolete request's decoding error", async () => {
    const pending = deferred();
    const runtime = bridge(vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined));
    const media = new runtime.Media(), playing = media.play(); await media.play();
    const error = new DOMException("Unsupported media", "NotSupportedError");
    const result = expect(playing).rejects.toBe(error); pending.reject(error); await result;
  });

  it("keeps the existing autoplay denial fallback", async () => {
    const runtime = bridge(vi.fn(() => Promise.reject(new DOMException("Activation required", "NotAllowedError"))));
    const media = new runtime.Media(), play = vi.fn(); media.addEventListener("play", play);
    await expect(media.play()).resolves.toBeUndefined(); expect(play).toHaveBeenCalledOnce();
  });

  it("cleans up pending cancellations and restores the native media method on exit", async () => {
    const pending = deferred(), runtime = bridge(vi.fn(() => pending.promise));
    const playing = new runtime.Media().play();
    await runtime.request("CLEANUP"); expect(runtime.Media.prototype.play).toBe(runtime.native);
    const result = expect(playing).resolves.toBeUndefined();
    pending.reject(new DOMException("Session exited", "AbortError")); await result;
  });
});
