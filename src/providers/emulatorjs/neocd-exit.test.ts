import {expect, it, vi} from "vitest";
import {requestNativeExit} from "./native-exit.js";

it("stops NeoCD without rebooting an already-aborted Range disc", () => {
  const restart = vi.fn(), flush = vi.fn();
  const functions = {restart};
  requestNativeExit({gameManager: {functions}, callEvent: () => {functions.restart(); flush(); return 0;}}, "neocd");
  expect(restart).not.toHaveBeenCalled();
  expect(flush).toHaveBeenCalledOnce(); expect(functions.restart).toBe(restart);
});
