import {expect, it, vi} from "vitest";
import {observeEmulatorJsStartup} from "./startup-observer.js";

it("keeps engine exception observation after the startup deadline ends and removes it on exit", () => {
  const failed = vi.fn(), observer = observeEmulatorJsStartup(window, new AbortController().signal, "yabause", false, failed);
  observer.ready();
  const trap = new WebAssembly.RuntimeError("out of bounds");
  window.dispatchEvent(new ErrorEvent("error", {message: "out of bounds", error: trap}));
  expect(failed).toHaveBeenCalledWith(expect.objectContaining({code: "PLAYER_RUNTIME_FAILED", cause: trap}));
  observer.stop(true);
  window.dispatchEvent(new ErrorEvent("error", {message: "ignored after exit"}));
  expect(failed).toHaveBeenCalledOnce();
});
