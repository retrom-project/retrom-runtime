import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {afterEach, expect, it, vi} from "vitest";

afterEach(() => {vi.clearAllTimers(); vi.useRealTimers(); document.body.replaceChildren();});

it.each([true, false])("restores after startup reaches a stable title with its save menu disabled (legacy=%s)", async legacy => {
  vi.useFakeTimers();
  const listeners = new Map<string, (event: unknown) => void>();
  const callbacks = new Map<string, () => void>();
  const replies: {requestId: number; type: string; body: unknown}[] = [];
  const ftag = {array_tag: [{name: "movie"}], current_order_index: 0};
  const snapshot = {title: "saved", save_date: "today", img_data: "", layer: {}, current_order_index: 4,
    stat: {current_scenario: "story.ks", f: {counter: 7}}};
  const variables = {sf: {counter: 0}};
  const loadGameData = vi.fn((saved: typeof snapshot) => {
    kag.stat = saved.stat;
    ftag.current_order_index = saved.current_order_index + 1;
    ftag.array_tag = Array.from({length: 6}, () => ({name: "l"}));
    callbacks.get("load-complete.retrom-runtime-restore")?.();
  });
  const kag: Record<string, unknown> = {
    event: {}, layer: {}, ftag, tmp: {}, variable: variables,
    key_mouse: {util: {canShowMenu: () => false}},
    menu: {snapSave() {}, loadGameData}, stat: {current_scenario: "title.ks", f: {}},
  };
  if (!legacy) {
    Object.assign(kag, {chara: {}, on() {}, off() {}, trigger() {},
      once: (name: string, callback: () => void) => callbacks.set(name, callback)});
  }
  for (const name of ["event", "layer", "ftag", "key_mouse", "menu", ...(!legacy ? ["chara"] : [])]) {
    (kag[name] as Record<string, unknown>).kag = kag;
  }
  const parent = {postMessage() {}}, port = {
    onmessage: null as null | ((event: {data: unknown}) => void), start() {},
    postMessage: (reply: typeof replies[number]) => replies.push(reply),
  };
  const global = {document, parent, TYRANO: {kag}, getComputedStyle: window.getComputedStyle.bind(window),
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    removeEventListener() {}, setTimeout, clearTimeout, setInterval: () => 1, requestAnimationFrame: () => 1};
  runInNewContext(readFileSync("assets/runtime/tyranoscript/bridge.js", "utf8"),
    {window: global, TextEncoder, TextDecoder, ArrayBuffer});
  const identity = {sessionId: "session", nonce: "abcdefghijklmnop", protocolVersion: 1};
  listeners.get("message")?.({source: parent, origin: "https://host.example", ports: [port],
    data: {...identity, parentOrigin: "https://host.example", type: "GAME_RUNTIME_TYRANOSCRIPT_CONNECT"}});
  const encoded = new TextEncoder().encode(JSON.stringify({engine: "TYRANOSCRIPT", schemaVersion: 1,
    snapshot, systemVariables: {counter: 7}}));
  const data = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(data).set(encoded);
  port.onmessage?.({data: {...identity, requestId: 1, type: "RESTORE", body: {data}}});
  await vi.advanceTimersByTimeAsync(32);
  expect(loadGameData).not.toHaveBeenCalled();
  expect(replies.filter(reply => reply.requestId === 1)).toEqual([]);
  // The intro finishes at a title stop; this game's native save menu stays disabled.
  ftag.array_tag[0] = {name: "s"};
  await vi.advanceTimersByTimeAsync(32);
  expect(loadGameData).toHaveBeenCalledOnce();
  expect(replies).toContainEqual(expect.objectContaining({requestId: 1, type: "RESTORE_RESULT"}));
  expect(variables.sf).toEqual({counter: 7});
  port.onmessage?.({data: {...identity, requestId: 2, type: "PROBE", body: {}}});
  expect(replies).toContainEqual(expect.objectContaining({requestId: 2, type: "PROBE_RESULT",
    body: expect.objectContaining({checkpointAvailable: false})}));
});
