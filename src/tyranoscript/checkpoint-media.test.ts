import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {afterEach, expect, it, vi} from "vitest";

type Reply = {type: string; requestId: number; body: {checkpointAvailable?: boolean; code?: string}};
afterEach(() => {document.body.replaceChildren();});

function bridge() {
  const listeners = new Map<string, (event: unknown) => void>(), replies: Reply[] = [];
  const kag: Record<string, unknown> = {
    on() {}, once() {}, off() {}, trigger() {}, chara: {}, event: {}, layer: {},
    ftag: {array_tag: [{name: "s"}], current_order_index: 0},
    key_mouse: {util: {canShowMenu: () => true}},
    menu: {snapSave: vi.fn(), loadGameData: vi.fn()}, stat: {current_scenario: "first.ks", f: {}},
  };
  for (const key of ["chara", "event", "layer", "ftag", "key_mouse", "menu"]) {
    (kag[key] as Record<string, unknown>).kag = kag;
  }
  const parent = {postMessage() {}}, port = {onmessage: null as null | ((event: {data: unknown}) => void),
    postMessage: (reply: Reply) => replies.push(reply), start() {}};
  const global = {document, parent, TYRANO: {kag}, getComputedStyle: window.getComputedStyle.bind(window),
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    removeEventListener() {}, setInterval: () => 1, requestAnimationFrame: () => 1};
  runInNewContext(readFileSync("assets/runtime/tyranoscript/bridge.js", "utf8"), {window: global, TextEncoder, TextDecoder});
  const identity = {sessionId: "session", nonce: "abcdefghijklmnop", protocolVersion: 1};
  listeners.get("message")?.({source: parent, origin: "https://host.example", ports: [port],
    data: {...identity, parentOrigin: "https://host.example", type: "GAME_RUNTIME_TYRANOSCRIPT_CONNECT"}});
  let requestId = 0;
  return async (type: string) => {
    requestId++;
    port.onmessage?.({data: {...identity, requestId, type, body: {}}});
    await vi.waitFor(() => expect(replies.find(reply => reply.requestId === requestId)).toBeDefined());
    return replies.find(reply => reply.requestId === requestId)!;
  };
}

it("rejects a stopped script's visible custom video outside the engine snapshot layers", async () => {
  const video = document.createElement("video"); document.body.append(video);
  const request = bridge();
  expect((await request("PROBE")).body.checkpointAvailable).toBe(false);
  expect(await request("CHECKPOINT")).toMatchObject({type: "ERROR", body: {code: "TYRANOSCRIPT_CHECKPOINT_UNAVAILABLE"}});
  video.remove();
  expect((await request("PROBE")).body.checkpointAvailable).toBe(true);
});

it("keeps native layer videos and invisible or completed external videos eligible", async () => {
  const base = document.createElement("div"); base.id = "tyrano_base";
  base.append(document.createElement("video")); document.body.append(base);
  const hidden = document.createElement("video"); hidden.style.display = "none"; document.body.append(hidden);
  const finished = document.createElement("video"); Object.defineProperty(finished, "ended", {value: true});
  document.body.append(finished);
  expect((await bridge()("PROBE")).body.checkpointAvailable).toBe(true);
});
