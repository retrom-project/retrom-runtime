import {expect, it, vi} from "vitest";
import {requestNativeExit} from "./native-exit.js";

it.each(["neocd", "flycast"])("stops %s without rebooting an already-aborted Range disc", core => {
  const restart = vi.fn(), flush = vi.fn();
  const functions = {restart};
  requestNativeExit({gameManager: {functions}, callEvent: () => {functions.restart(); flush(); return 0;}}, core);
  expect(restart).not.toHaveBeenCalled();
  expect(flush).toHaveBeenCalledOnce(); expect(functions.restart).toBe(restart);
});
