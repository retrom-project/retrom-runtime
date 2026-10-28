import {afterEach, expect, it, vi} from "vitest";
import {nativeFrameLoop} from "./native-frame-loop.js";
import {canvasRuntimeEvents} from "./canvas-runtime-events.js";

afterEach(() => vi.restoreAllMocks());
function animationClock() {
  let frame: FrameRequestCallback = () => undefined;
  const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {frame = callback; return 42;});
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  return {request, cancel, tick: (time: number) => frame(time)};
}

it("bounds catch-up frames and discards elapsed time across a paused session", () => {
  const clock = animationClock(), step = vi.fn(), draw = vi.fn();
  let active = true;
  const loop = nativeFrameLoop(window, {active: () => active, framesPerSecond: () => 50,
    timingError: "TIMING_INVALID", step, draw, onFailure: error => {throw error;}});
  loop.start(); clock.tick(100); expect(step).toHaveBeenCalledTimes(1);
  clock.tick(1000); expect(step).toHaveBeenCalledTimes(6);
  active = false; loop.stop(); clock.tick(2000);
  expect(step).toHaveBeenCalledTimes(6); expect(clock.cancel).toHaveBeenCalledWith(42);
  active = true; loop.resume(); clock.tick(10000);
  expect(step).toHaveBeenCalledTimes(7); expect(draw).toHaveBeenCalledTimes(3);
});

it("reports invalid native timing and failed execution without rescheduling", () => {
  const clock = animationClock(), step = vi.fn(), failed = vi.fn();
  const options = {active: () => true, framesPerSecond: () => 0, timingError: "CORE_TIMING_INVALID",
    step, draw: vi.fn(), onFailure: failed};
  nativeFrameLoop(window, options).start(); clock.tick(100);
  expect(failed).toHaveBeenCalledWith(new Error("CORE_TIMING_INVALID"));
  expect(step).not.toHaveBeenCalled(); expect(clock.request).toHaveBeenCalledOnce();
  const failure = new Error("CORE_EXECUTION_FAILED");
  step.mockImplementation(() => {throw failure;});
  nativeFrameLoop(window, {...options, framesPerSecond: () => 50}).start(); clock.tick(100);
  expect(failed).toHaveBeenLastCalledWith(failure); expect(clock.request).toHaveBeenCalledTimes(2);
});

it("owns keyboard, blur, audio unlock and abort listeners until the session exits", () => {
  const controller = new AbortController(), keyboard = vi.fn(), releaseKeys = vi.fn(), unlock = vi.fn();
  const exit = vi.fn(async () => undefined);
  const events = canvasRuntimeEvents(window, {keyboard, releaseKeys, unlock, exit, signal: controller.signal});
  events.listen();
  window.dispatchEvent(new KeyboardEvent("keydown", {code: "KeyZ"}));
  window.dispatchEvent(new KeyboardEvent("keyup", {code: "KeyZ"}));
  window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("pointerdown"));
  expect(keyboard).toHaveBeenCalledTimes(2); expect(releaseKeys).toHaveBeenCalledOnce(); expect(unlock).toHaveBeenCalledOnce();
  controller.abort(); expect(exit).toHaveBeenCalledOnce(); events.dispose();
  window.dispatchEvent(new KeyboardEvent("keydown", {code: "KeyZ"}));
  window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("pointerdown"));
  expect(keyboard).toHaveBeenCalledTimes(2); expect(releaseKeys).toHaveBeenCalledOnce(); expect(unlock).toHaveBeenCalledOnce();
});
