import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {afterEach, expect, it, vi} from "vitest";

type Reply = {type: string; requestId: number; body: {checkpointAvailable?: boolean; code?: string; data?: ArrayBuffer}};
afterEach(() => {document.body.replaceChildren();});

function bridge(options: {menuAllowed?: boolean; strongStop?: boolean; tag?: string; waiting?: boolean;
  legacy?: boolean; snapshot?: Record<string, unknown>} = {}) {
  const listeners = new Map<string, (event: unknown) => void>(), replies: Reply[] = [];
  const kag: Record<string, unknown> = {
    ...(!options.legacy ? {on() {}, once() {}, off() {}, trigger() {}, chara: {}} : {}), event: {}, layer: {},
    ftag: {array_tag: [{name: options.tag ?? "s"}], current_order_index: 0},
    key_mouse: {util: {canShowMenu: () => options.menuAllowed ?? true}},
    menu: {snap: options.snapshot, snapSave: vi.fn((_title: string, callback: () => void) => callback()), loadGameData: vi.fn()},
    stat: {current_scenario: "first.ks", f: {}, is_strong_stop: options.strongStop === true, is_wait: options.waiting === true},
  };
  for (const key of ["event", "layer", "ftag", "key_mouse", "menu", ...(!options.legacy ? ["chara"] : [])]) {
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

it.each([true, false])("captures a stable choice layer while its native menu is disabled (legacy=%s)", async legacy => {
  const choices = '<div class="layer_free"><button class="event-setting-element">Continue</button></div>';
  const snapshot = {title: "choice", save_date: "today", img_data: "", current_order_index: -1,
    stat: {current_scenario: "first.ks", f: {counter: 7}, is_strong_stop: true}, layer: {layer_free: choices}};
  const request = bridge({legacy, menuAllowed: false, strongStop: true, snapshot});
  expect((await request("PROBE")).body.checkpointAvailable).toBe(true);
  const result = await request("CHECKPOINT");
  expect(result.type).toBe("CHECKPOINT_RESULT");
  const decoded = JSON.parse(new TextDecoder().decode(result.body.data));
  expect(decoded.snapshot.layer.layer_free).toBe(choices);
  expect(decoded.snapshot.stat).toMatchObject({f: {counter: 7}, is_strong_stop: true});
});

it.each([
  {strongStop: false},
  {strongStop: true, tag: "movie"},
  {strongStop: true, waiting: true},
])("keeps native menu restrictions outside a stable choice stop: %j", async options => {
  const request = bridge({...options, menuAllowed: false});
  expect((await request("PROBE")).body.checkpointAvailable).toBe(false);
  expect(await request("CHECKPOINT")).toMatchObject({type: "ERROR", body: {code: "TYRANOSCRIPT_CHECKPOINT_UNAVAILABLE"}});
});
