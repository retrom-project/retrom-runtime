import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {afterEach, expect, it, vi} from "vitest";

afterEach(() => {vi.clearAllTimers(); vi.useRealTimers(); document.body.replaceChildren();});

function setup(legacy: boolean, helperIndex = 1) {
  vi.useFakeTimers();
  const listeners = new Map<string, (event: unknown) => void>();
  const callbacks = new Map<string, () => void>();
  const replies: {requestId: number; type: string; body: unknown}[] = [];
  const savedText = "Saved first line.Saved second line.";
  const snapshot = {title: "saved", save_date: "today", img_data: "",
    layer: {map_layer_fore: {message0: `<div class="message_inner"><p>Saved first line.</p><p>Saved second line.</p></div>`}},
    current_order_index: 4, stat: {current_scenario: "story.ks", flag_ref_page: true, f: {counter: 7}}};
  const ftag = {array_tag: [{name: "s"}], current_order_index: 0};
  let receivedPageClear: unknown;
  const loadGameData = vi.fn((saved: typeof snapshot) => {
    receivedPageClear = saved.stat.flag_ref_page;
    document.body.innerHTML = saved.layer.map_layer_fore.message0;
    // Native loading aliases the supplied stat and runs make.ks and its helper scripts.
    kag.stat = saved.stat;
    kag.stat.current_scenario = "make.ks";
    setTimeout(() => {
      kag.stat.current_scenario = "helper.ks";
      ftag.current_order_index = helperIndex;
      if (legacy && kag.stat.flag_ref_page) {
        document.querySelector(".message_inner")!.replaceChildren();
        kag.stat.flag_ref_page = false;
      }
    }, 8);
    setTimeout(() => {
      kag.stat.current_scenario = "story.ks";
      ftag.current_order_index = 5;
      ftag.array_tag = Array.from({length: 6}, () => ({name: "p"}));
      kag.stat.flag_ref_page = true;
      callbacks.get("load-complete.retrom-runtime-restore")?.();
    }, 48);
  });
  const kag = {
    event: {}, layer: {}, ftag, tmp: {}, variable: {sf: {}}, key_mouse: {},
    menu: {snapSave() {}, loadGameData},
    stat: {current_scenario: "title.ks", flag_ref_page: false, f: {counter: 0}},
  };
  if (!legacy) Object.assign(kag, {chara: {}, on() {}, off() {}, trigger() {},
    once: (name: string, callback: () => void) => callbacks.set(name, callback)});
  for (const name of ["event", "layer", "ftag", "key_mouse", "menu", ...(!legacy ? ["chara"] : [])]) {
    (kag as unknown as Record<string, Record<string, unknown>>)[name].kag = kag;
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
  return {kag, ftag, replies, savedText, loadGameData, receivedPageClear: () => receivedPageClear};
}

it.each([true, false])("retains saved dialogue and clears it on the first page advance (legacy=%s)", async legacy => {
  const {kag, ftag, replies, savedText, loadGameData, receivedPageClear} = setup(legacy);
  expect(loadGameData).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(16);
  expect(document.querySelector(".message_inner")?.textContent).toBe(savedText);
  expect(replies.filter(reply => reply.requestId === 1)).toEqual([]);
  await vi.advanceTimersByTimeAsync(64);
  expect(replies).toContainEqual(expect.objectContaining({requestId: 1, type: "RESTORE_RESULT"}));
  expect(kag.stat.flag_ref_page).toBe(true);
  expect(document.querySelector(".message_inner")?.textContent).toBe(savedText);
  expect(receivedPageClear()).toBe(!legacy);
  const message = document.querySelector(".message_inner")!;
  message.addEventListener("click", () => {
    if (kag.stat.flag_ref_page) {message.replaceChildren(); kag.stat.flag_ref_page = false;}
    message.append("Next page.");
    ftag.current_order_index += 1;
  });
  message.dispatchEvent(new MouseEvent("click"));
  expect(message.textContent).toBe("Next page.");
  expect(ftag.current_order_index).toBe(6);
});

it("waits for the saved scenario when native loading mutates the supplied stat", async () => {
  const {kag, replies} = setup(true, 5);
  await vi.advanceTimersByTimeAsync(32);
  expect(kag.stat.current_scenario).toBe("helper.ks");
  expect(replies.filter(reply => reply.requestId === 1)).toEqual([]);
  await vi.advanceTimersByTimeAsync(32);
  expect(kag.stat.current_scenario).toBe("story.ks");
  expect(replies).toContainEqual(expect.objectContaining({requestId: 1, type: "RESTORE_RESULT"}));
});
