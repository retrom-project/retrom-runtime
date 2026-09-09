import {expect, it, vi} from "vitest";
import {installCoreErrors} from "./errors.js";
it("reports a deferred core trap once and removes both failure listeners on exit", () => {
  const failed = vi.fn();
  const dispose = installCoreErrors(window, failed);
  window.dispatchEvent(new Event("unhandledrejection"));
  window.dispatchEvent(new Event("error"));
  expect(failed).toHaveBeenCalledOnce();
  dispose(); failed.mockClear();
  window.dispatchEvent(new Event("error"));
  window.dispatchEvent(new Event("unhandledrejection"));
  expect(failed).not.toHaveBeenCalled();
});
