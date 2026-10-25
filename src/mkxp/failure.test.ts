import {afterEach, expect, it, vi} from "vitest";
import {RuntimeFailureError} from "../provider/failure.js";
import {createHarness, mkxpConfig, mountMkxp} from "../../tests/mkxp-adapter-fixture.js";

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});

it.each(["failed to load font (SDLError)", "script failure (RuntimeError)", "missing asset (Errno::ENOENT)"])(
  "reports %s after opening frames and disables checkpoint creation", async (message) => {
  const harness = createHarness();
  const mounted = await mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies);
  const print = harness.prepareOptions!.emscriptenModule.printErr!;
  const reason = `[libretro ERROR] [mkxp-z exception] 012:GameScript:55:in 'update': ${message}`;
  print(reason);
  for (let line = 0; line < 20; line++) {print(`[libretro ERROR] [mkxp-z exception]        from ${line}:Scene_Map:17:in 'start'`);}
  print("[libretro ERROR] [mkxp-z @ ../src/core.cpp:1613] Game threw an exception; terminating");
  harness.runtime.observation.failure = -1;
  let failure: unknown;
  try {mounted.getCheckpointAvailability();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(RuntimeFailureError);
  expect(failure).toMatchObject({code: "RPG_RUNTIME_GAME_FAILED", category: "CORE", diagnostics: [reason]});
  await expect(mounted.checkpoint()).rejects.toThrow("RPG_RUNTIME_GAME_FAILED");
  expect(harness.runtime.requestState).not.toHaveBeenCalled();
  await mounted.exit();
  harness.frame.remove();
});

it("reports a native sandbox abort with its fatal diagnostic", async () => {
  const harness = createHarness();
  const mounted = await mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies);
  const print = harness.prepareOptions!.emscriptenModule.printErr!;
  const reason = "[mkxp-z @ ../binding-sandbox/wasm-rt.cpp:74] Fatal error: Sandbox trap";
  print(reason);
  print(`[libretro ERROR] ${reason}`);
  print("Aborted()");
  harness.runtime.observation.failure = -1;
  let failure: unknown;
  try {mounted.getCheckpointAvailability();} catch (error) {failure = error;}
  expect(failure).toMatchObject({code: "RPG_RUNTIME_GAME_FAILED", category: "CORE", diagnostics: [reason]});
  await mounted.exit();
  harness.frame.remove();
});

it("rejects a game exception before its first frame without waiting for a startup timeout", async () => {
  const harness = createHarness();
  harness.runtime.start.mockImplementation(async () => {harness.runtime.observation.failure = -1;});
  const result = mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(100);
  expect(await Promise.race([result, Promise.resolve(null)])).toMatchObject({code: "RPG_RUNTIME_GAME_FAILED"});
  expect(harness.runtime.exit).toHaveBeenCalledOnce();
  harness.frame.remove();
});

it("keeps recoverable graphics diagnostics separate from the native game failure result", async () => {
  const harness = createHarness();
  const mounted = await mountMkxp(mkxpConfig(), harness.target, null, harness.dependencies);
  harness.prepareOptions!.emscriptenModule.printErr!("[ERROR] [HW] Requesting OpenGL context, but RetroArch is compiled against OpenGLES.");
  expect(mounted.getCheckpointAvailability()).toEqual({available: true, blocker: null});
  expect(mounted.getFrameCount()).toBe(599);
  await mounted.exit();
  harness.frame.remove();
});
