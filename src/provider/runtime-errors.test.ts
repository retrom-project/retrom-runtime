import {expect, it, vi} from "vitest";
import {observeRuntimeErrors} from "./runtime-errors.js";

const resizeNotice = "ResizeObserver loop completed with undelivered notifications.";

it.each(["", window.location.href])("leaves browser resize notifications observable: %s", (filename) => {
  const failed = vi.fn(), notified = vi.fn();
  const stop = observeRuntimeErrors(window, failed);
  window.addEventListener("error", notified);
  try {
    const event = new ErrorEvent("error", {message: resizeNotice, filename, cancelable: true});
    window.dispatchEvent(event);
    expect(failed).not.toHaveBeenCalled();
    expect(notified).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  } finally {
    stop(); window.removeEventListener("error", notified);
  }
});

it.each([
  {message: resizeNotice, error: new Error(resizeNotice)},
  {message: resizeNotice, filename: "engine.js", lineno: 4},
  {message: "Script error."},
  {message: "out of bounds", error: new WebAssembly.RuntimeError("out of bounds")},
])("continues to fail on actual engine exceptions: $message", (init) => {
  const failed = vi.fn(), stop = observeRuntimeErrors(window, failed);
  try {
    window.dispatchEvent(new ErrorEvent("error", init));
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({code: "PLAYER_RUNTIME_FAILED"}));
  } finally {stop();}
});
