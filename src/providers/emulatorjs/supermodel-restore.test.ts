import {expect, it, vi} from "vitest";

import {installSupermodelRestore} from "./supermodel-restore.js";

it("waits for the native Model 3 state load after a new Launch", async () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const playerWindow = frame.contentWindow as Window & {EJS_Runtime?: (config: Record<string, unknown>) => void};
  const hook = installSupermodelRestore(playerWindow);
  let nativeConfig!: Record<string, (...args: unknown[]) => void>;
  playerWindow.EJS_Runtime = config => {nativeConfig = config as typeof nativeConfig;};
  playerWindow.EJS_Runtime({print: vi.fn(), postMainLoop: vi.fn()});
  const files = new Map<string, Uint8Array>();
  const toggleMainLoop = vi.fn();
  const loadState = vi.fn(function (this: {print: typeof nativeConfig.print}) {
    this.print("[INFO] [State]: Loading state \"game.state\", 4 bytes.");
  });
  const manager = {
    FS: {unlink: (path: string) => {files.delete(path);}, writeFile: (path: string, bytes: Uint8Array) => {files.set(path, bytes);}},
    Module: {cwrap: () => () => "4|0|1"},
    functions: {loadState, print: (...args: unknown[]) => nativeConfig.print(...args), toggleMainLoop},
    getFrameNum: () => 1, toggleMainLoop(running: boolean) {this.functions.toggleMainLoop(running);},
  };
  const detach = hook.attach(manager);
  const restoreManager = manager as typeof manager & {loadExplicitStateAndWait: (state: Uint8Array) => Promise<void>};
  const restored = restoreManager.loadExplicitStateAndWait(Uint8Array.of(1, 2, 3, 4));
  let finished = false;
  void restored.then(() => {finished = true;});
  await Promise.resolve();
  expect(files.get("/game.state")).toEqual(Uint8Array.of(1, 2, 3, 4));
  expect(finished).toBe(false);
  nativeConfig.postMainLoop();
  await restored;
  expect(finished).toBe(true);
  expect(files.has("/game.state")).toBe(false);
  expect(toggleMainLoop).toHaveBeenLastCalledWith(false);
  expect(loadState).toHaveBeenCalledOnce();
  detach(); hook.cleanup(); frame.remove();
});
