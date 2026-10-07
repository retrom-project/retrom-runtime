import {expect, it, vi} from "vitest";
import {installCoreErrors} from "./errors.js";
it("reports a deferred core trap once and removes both failure listeners on exit", () => {
  const failed = vi.fn();
  const dispose = installCoreErrors(window, failed, () => false);
  const trap = new WebAssembly.RuntimeError("memory access out of bounds");
  window.dispatchEvent(Object.assign(new Event("unhandledrejection"), {reason: trap}));
  window.dispatchEvent(new Event("error"));
  expect(failed).toHaveBeenCalledOnce();
  expect(failed).toHaveBeenCalledWith(trap);
  dispose(); failed.mockClear();
  window.dispatchEvent(new Event("error"));
  window.dispatchEvent(new Event("unhandledrejection"));
  expect(failed).not.toHaveBeenCalled();
});
it("preserves an iframe error and ignores resource load events", () => {
  const failed = vi.fn();
  const dispose = installCoreErrors(window, failed, () => false);
  const script = document.createElement("script");
  document.body.append(script);
  script.dispatchEvent(new Event("error", {bubbles: true}));
  expect(failed).not.toHaveBeenCalled();
  const trap = new WebAssembly.RuntimeError("unreachable");
  window.dispatchEvent(new ErrorEvent("error", {error: trap, message: trap.message}));
  expect(failed).toHaveBeenCalledWith(trap);
  dispose(); script.remove();
});
it.each([
  [false, {name: "ExitStatus", status: 0}],
  [true, {name: "ExitStatus", status: 1}],
  [true, {name: "RuntimeError", status: 0}],
])("preserves unexpected failures with completed exit %s and reason %o", (completed, reason) => {
  const failed = vi.fn();
  const dispose = installCoreErrors(window, failed, () => completed);
  const event = Object.assign(new Event("unhandledrejection", {cancelable: true}), {reason});
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(failed).toHaveBeenCalledWith(reason);
  dispose();
});
