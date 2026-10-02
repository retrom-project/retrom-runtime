import {afterEach, expect, it, vi} from "vitest";
import {mountEasyRpg} from "./adapter.js";

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); document.head.replaceChildren(); document.body.replaceChildren();});

it("rejects an uncaught Embind failure even when the factory promise stays pending", async () => {
  vi.useFakeTimers();
  const target = document.createElement("div"); document.body.append(target);
  Object.defineProperty(window, "createEasyRpgPlayer", {configurable: true, value: () => new Promise(() => {})});
  const mounting = mountEasyRpg({sessionId: "session", engineMode: "rpg2k", runtimeBaseUrl: "/core/",
    projectRootUrl: "/game/", rtpSource: null, checkpointSlot: 100}, target, window, null, {signal: new AbortController().signal, reportExitRequested: () => {}});
  const result = mounting.catch(error => error);
  await vi.advanceTimersByTimeAsync(0);
  document.head.querySelector("script")?.dispatchEvent(new Event("load"));
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new ErrorEvent("error", {error: new EvalError("Embind invoker blocked")}));
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await Promise.race([result, Promise.resolve("still pending")])).toMatchObject({code: "PLAYER_RUNTIME_INITIALIZATION_FAILED"});
  expect(target.childElementCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
