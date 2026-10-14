import {expect, it, vi} from "vitest";
import {installNativeExit, requestNativeExit} from "./native-exit.js";
import type {EjsInstance} from "./emulator-instance.js";

function fixture() {
  const restart = vi.fn(), flush = vi.fn(), stop = vi.fn();
  const functions = {restart};
  const instance: EjsInstance = {gameManager: {functions}, callEvent: vi.fn(function (this: EjsInstance, event, data) {
    expect(this).toBe(instance);
    if (event !== "exit") {functions.restart(); return Number(data);}
    flush(); functions.restart(); flush(); stop(); return 1;
  })};
  return {instance, functions, restart, flush, stop};
}

it.each(["host", "beforeunload"])("exits through %s without rebooting and preserves native flush and stop", source => {
  const {instance, functions, restart, flush, stop} = fixture();
  installNativeExit(instance);
  if (source === "host") {requestNativeExit(instance);} else {expect(instance.callEvent?.("exit")).toBe(1);}
  expect(restart).not.toHaveBeenCalled(); expect(flush).toHaveBeenCalledTimes(2); expect(stop).toHaveBeenCalledOnce();
  expect(functions.restart).toBe(restart);
  expect(instance.callEvent?.("exit")).toBe(0);
  expect(stop).toHaveBeenCalledOnce();
});

it("resolves the manager at dispatch time and leaves normal restart events intact", () => {
  const {instance, restart} = fixture(), manager = instance.gameManager;
  delete instance.gameManager;
  installNativeExit(instance);
  instance.gameManager = manager;
  expect(instance.callEvent?.("restart", 7)).toBe(7); expect(restart).toHaveBeenCalledOnce();
  instance.callEvent?.("exit"); expect(restart).toHaveBeenCalledOnce();
});

it("restores restart on an exit failure and never retries partially completed native teardown", () => {
  const {instance, functions, restart} = fixture();
  instance.callEvent = vi.fn(() => {functions.restart(); throw new Error("exit failed");});
  const dispatch = instance.callEvent;
  installNativeExit(instance);
  expect(() => instance.callEvent?.("exit")).toThrow("exit failed");
  expect(functions.restart).toBe(restart); expect(restart).not.toHaveBeenCalled();
  requestNativeExit(instance); expect(dispatch).toHaveBeenCalledOnce();
});
