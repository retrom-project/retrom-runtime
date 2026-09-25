import {expect, it, vi} from "vitest";
import {installAsyncRangeStartup} from "./async-range-startup.js";

it.each(["disc.chd", "ggisuka.zip"])("defers %s main loop until asynchronous native boot completes", async filename => {
  let resolve!: () => void;
  let finishNative!: () => void;
  const idle = vi.fn(() => new Promise<void>(done => {resolve = done;}));
  const retromWhenAsyncifyDone = vi.fn(() => new Promise<void>(done => {finishNative = done;}));
  const callMain = vi.fn(), resume = vi.fn(), started = vi.fn(), fail = vi.fn();
  const instance = {fileName: filename, Module: {callMain, retromWhenAsyncifyDone}, startGame() {this.Module.callMain([`/${filename}`]); resume(); started();}};
  installAsyncRangeStartup(instance, {idle, fail});
  const starting = instance.startGame();
  expect(callMain).toHaveBeenCalledOnce(); expect(retromWhenAsyncifyDone).toHaveBeenCalledOnce();
  expect(resume).not.toHaveBeenCalled(); expect(started).not.toHaveBeenCalled();
  finishNative(); await Promise.resolve();
  expect(idle).toHaveBeenCalledOnce(); expect(resume).not.toHaveBeenCalled();
  resolve(); await starting;
  expect(callMain).toHaveBeenCalledOnce(); expect(instance.Module.callMain).toBe(callMain);
  expect(resume).toHaveBeenCalledOnce(); expect(started).toHaveBeenCalledOnce(); expect(fail).not.toHaveBeenCalled();
});
