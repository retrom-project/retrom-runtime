import {expect, it, vi} from "vitest";
import {installNeoCDStartup} from "./neocd-startup.js";

it("defers the frontend main loop and ready event until asynchronous native boot completes", async () => {
  let resolve!: () => void;
  const idle = vi.fn(() => new Promise<void>(done => {resolve = done;}));
  const callMain = vi.fn(), resume = vi.fn(), started = vi.fn(), fail = vi.fn();
  const instance = {fileName: "disc.chd", Module: {callMain}, startGame() {this.Module.callMain(["/disc.chd"]); resume(); started();}};
  installNeoCDStartup(instance, {idle, fail});
  const starting = instance.startGame();
  expect(callMain).toHaveBeenCalledOnce(); expect(resume).not.toHaveBeenCalled(); expect(started).not.toHaveBeenCalled();
  resolve(); await starting;
  expect(callMain).toHaveBeenCalledOnce(); expect(instance.Module.callMain).toBe(callMain);
  expect(resume).toHaveBeenCalledOnce(); expect(started).toHaveBeenCalledOnce(); expect(fail).not.toHaveBeenCalled();
});
