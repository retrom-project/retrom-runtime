import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {expect, it, vi} from "vitest";

it("enables native bridge observation on demand without polling or changing engine inputs", async () => {
  type Reply = {requestId: number; type: string; body: {inputDiagnostics?: {events: Array<{value: number; target: string}>}}};
  type Handler = (event: {data: unknown; origin?: string; source?: unknown; ports?: unknown[]; stopImmediatePropagation?: () => void}) => void;
  const handlers = new Map<string, Handler>();
  const update = vi.fn();
  const input = {_updateGamepadState: update, gamepadMapper: {0: "ok"}};
  const replies: Reply[] = [];
  const port: {onmessage: Handler | null; start: () => void; postMessage: (reply: Reply) => void} = {
    onmessage: null, start: () => undefined, postMessage: (reply) => replies.push(reply),
  };
  const requestAnimationFrame = vi.fn();
  const nativeGetGamepads = vi.fn(() => [{index: 0, buttons: [{pressed: true, value: 1, touched: true}], axes: [0.5]}]);
  const runtime = {
    Input: input, performance: {now: () => 100}, document: {hasFocus: () => true},
    Utils: {RPGMAKER_NAME: "MV"}, SceneManager: {updateMain: () => undefined}, DataManager: {}, StorageManager: {},
    parent: {postMessage: () => undefined}, requestAnimationFrame, navigator: {getGamepads: nativeGetGamepads},
    addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
    removeEventListener: (name: string) => handlers.delete(name),
  };
  runInNewContext(readFileSync("assets/runtime/native/bridge.js", "utf8"), {window: runtime, TextEncoder, TextDecoder});
  const identity = {launchId: "fixture", nonce: "fixture", protocolVersion: 1};
  handlers.get("message")?.({data: {...identity, type: "RPG_RUNTIME_NATIVE_CONNECT",
    parentOrigin: "https://host.example", profile: "RPGMV"}, origin: "https://host.example", source: runtime.parent, ports: [port], stopImmediatePropagation: () => undefined});
  let requestId = 0;
  const request = async (type: string, body: Record<string, unknown> = {}) => {
    const id = ++requestId;
    port.onmessage?.({data: {...identity, requestId: id, type, body}});
    await vi.waitFor(() => expect(replies.some((reply) => reply.requestId === id)).toBe(true));
    return replies.find((reply) => reply.requestId === id)!;
  };
  expect(input._updateGamepadState).toBe(update);
  expect((await request("INPUT_DIAGNOSTICS", {enabled: true})).type).toBe("INPUT_DIAGNOSTICS_RESULT");
  input._updateGamepadState({index: 0, buttons: [{pressed: true}]});
  input._updateGamepadState({index: 0, buttons: [{pressed: false}]});
  const result = await request("STATUS");
  expect(result.body.inputDiagnostics?.events.map((event) => [event.value, event.target])).toEqual([[1, "ok"], [0, "ok"]]);
  expect(update).toHaveBeenCalledTimes(2);
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  await request("INPUT_DIAGNOSTICS", {enabled: false});
  expect(input._updateGamepadState).toBe(update);
  expect(handlers.has("keydown")).toBe(false);
  expect((await request("STATUS")).body.inputDiagnostics).toBeUndefined();
  expect((await request("SET_INPUT_FILTER", {policy: {activeGamepadIndex: 0, suppressInput: true}})).type)
    .toBe("SET_INPUT_FILTER_RESULT");
  expect(runtime.navigator.getGamepads()[0]?.buttons[0]?.pressed).toBe(false);
  expect(runtime.navigator.getGamepads()[0]?.axes).toEqual([0]);
  await request("SET_INPUT_FILTER", {policy: null});
  expect(runtime.navigator.getGamepads()[0]?.buttons[0]?.pressed).toBe(true);
  expect((await request("SET_INPUT_FILTER", {policy: {activeGamepadIndex: -1, suppressInput: true}})).type).toBe("ERROR");
  await request("CLEANUP");
  expect(runtime.navigator.getGamepads).toBe(nativeGetGamepads);
});
