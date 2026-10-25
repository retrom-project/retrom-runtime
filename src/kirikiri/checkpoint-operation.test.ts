import {afterEach, expect, it, vi} from "vitest";
import {createKirikiriCheckpointOperation} from "./checkpoint-operation.js";
import {decodeKirikiriCheckpoint} from "./checkpoint.js";
import {KirikiriWriteOverlay} from "./write-overlay.js";
import {suspendingBookmark, type KirikiriJspi} from "../../tests/kirikiri-checkpoint-fixture.js";

afterEach(() => {vi.useRealTimers();});

it("flushes late native metadata after the frame drains and includes it in the same save", async () => {
  const {operation, module, overlay} = fixture();
  const flush = vi.fn(async () => {
    overlay.record("/settings.ksd", Uint8Array.of(8, 1));
    return 1;
  });
  Object.assign(module, {_krkr2_host_flush_game_saves: flush});
  const saved = await operation.checkpoint();
  expect(flush).toHaveBeenCalledOnce();
  expect(module.pauseMainLoop.mock.invocationCallOrder[0]).toBeLessThan(flush.mock.invocationCallOrder[0]!);
  expect((await decodeKirikiriCheckpoint(saved.bytes)).entries).toContainEqual({path: "settings.ksd", data: Uint8Array.of(8, 1)});
  await operation.stop();
});

it("awaits the real JSPI native metadata callback while cold I/O suspends its Wasm stack", async () => {
  const {operation, module, overlay} = fixture();
  const wasm = window.WebAssembly as KirikiriJspi;
  let finish!: () => void;
  const reading = new Promise<void>(resolve => {finish = resolve;});
  const native = wasm.promising(suspendingBookmark(wasm, () => reading.then(() => {
    overlay.record("/settings.ksd", Uint8Array.of(2, 1));
  }), 1));
  module._krkr2_host_flush_game_saves.mockImplementationOnce(() => native(0));
  let captured = false;
  const capturing = operation.checkpoint(); void capturing.then(() => {captured = true;});
  await vi.waitFor(() => expect(module._krkr2_host_flush_game_saves).toHaveBeenCalledOnce());
  expect(captured).toBe(false); expect(module.resumeMainLoop).not.toHaveBeenCalled();
  finish();
  expect((await decodeKirikiriCheckpoint((await capturing).bytes)).entries).toContainEqual({path: "settings.ksd", data: Uint8Array.of(2, 1)});
  await operation.stop();
});

it.each([-3, -4, -5, 2, undefined])("rejects failed native metadata flush %s without publishing a save", async result => {
  const {operation, module} = fixture();
  module._krkr2_host_flush_game_saves.mockResolvedValueOnce(result as number);
  await expect(operation.checkpoint()).rejects.toMatchObject({message: "KIRIKIRI_CHECKPOINT_CREATE_FAILED",
    cause: {message: `KIRIKIRI_GAME_SAVE_FLUSH_FAILED: ${result}`}});
  await operation.stop();
});

it("retains a suspended native flush through cancellation before releasing its files", async () => {
  const {operation, module, overlay} = fixture();
  let finish!: (value: number) => void;
  module._krkr2_host_flush_game_saves.mockImplementationOnce(() => new Promise<number>(resolve => {finish = resolve;}));
  const capturing = operation.checkpoint().catch(error => error as Error);
  await vi.waitFor(() => expect(module._krkr2_host_flush_game_saves).toHaveBeenCalledOnce());
  let stopped = false;
  const stopping = operation.stop(); void stopping.then(() => {stopped = true;});
  await Promise.resolve(); expect(stopped).toBe(false);
  overlay.record("/settings.ksd", Uint8Array.of(9)); finish(1);
  expect(await capturing).toMatchObject({message: "KIRIKIRI_RUNTIME_INVALID_STATE"});
  await stopping; expect(module.resumeMainLoop).not.toHaveBeenCalled();
});

it("does not reenter native scripts after a normal engine exit", async () => {
  const {operation, module} = fixture();
  expect(await operation.finalCheckpoint()).not.toBeNull();
  expect(module._krkr2_host_flush_game_saves).not.toHaveBeenCalled();
  await operation.stop();
});

it("hands an active capture to normal exit without reentering native scripts", async () => {
  const {operation, module} = fixture();
  let finish!: () => void;
  module.pauseMainLoop.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
  const ordinary = operation.checkpoint();
  await vi.waitFor(() => expect(module.pauseMainLoop).toHaveBeenCalledOnce());
  const final = operation.finalCheckpoint();
  finish();
  expect(await ordinary).toMatchObject({format: "kirikiri-game-save-v1"});
  expect(await final).not.toBeNull();
  expect(module._krkr2_host_flush_game_saves).not.toHaveBeenCalled();
  expect(module.resumeMainLoop).not.toHaveBeenCalled();
  await operation.stop();
});

it("finishes an active capture when the exiting JSPI frame unwinds with ExitStatus(0)", async () => {
  const {operation, module} = fixture();
  const wasm = window.WebAssembly as KirikiriJspi;
  let finish!: () => void;
  const draining = new Promise<void>((_resolve, reject) => {
    finish = () => reject({name: "ExitStatus", status: 0, message: "Program terminated with exit(0)"});
  });
  const tick = wasm.promising(suspendingBookmark(wasm, () => draining, 1));
  module.pauseMainLoop.mockImplementationOnce(() => tick(0).then(() => undefined));
  const ordinary = operation.checkpoint();
  await vi.waitFor(() => expect(module.pauseMainLoop).toHaveBeenCalledOnce());
  const final = operation.finalCheckpoint();
  const ordinaryResult = expect(ordinary).resolves.toMatchObject({format: "kirikiri-game-save-v1"});
  const finalResult = expect(final).resolves.not.toBeNull();
  finish();
  await Promise.all([ordinaryResult, finalResult]);
  expect((await decodeKirikiriCheckpoint((await final)!.bytes)).entries).toEqual([
    {path: "profile/玩家/slot.png", data: Uint8Array.of(4, 2)},
  ]);
  expect(module._krkr2_host_flush_game_saves).not.toHaveBeenCalled();
  expect(module.resumeMainLoop).not.toHaveBeenCalled();
  await operation.stop();
});

it.each([new WebAssembly.RuntimeError("unreachable"), new Error("Aborted(native failure)"),
  {name: "ExitStatus", status: 1}, {name: "ExitStatus", status: "0"}, {status: 0}])(
  "preserves a failed active frame during final handoff %#", async failure => {
  const {operation, module} = fixture();
  let finish!: () => void;
  module.pauseMainLoop.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
    finish = () => reject(failure);
  }));
  const ordinary = operation.checkpoint();
  await vi.waitFor(() => expect(module.pauseMainLoop).toHaveBeenCalledOnce());
  const final = operation.finalCheckpoint();
  const ordinaryResult = expect(ordinary).rejects.toMatchObject({message: "KIRIKIRI_CHECKPOINT_CREATE_FAILED", cause: failure});
  const finalResult = expect(final).rejects.toMatchObject({message: "KIRIKIRI_CHECKPOINT_CREATE_FAILED", cause: failure});
  finish();
  await Promise.all([ordinaryResult, finalResult]);
  expect(module._krkr2_host_flush_game_saves).not.toHaveBeenCalled();
  expect(module.resumeMainLoop).not.toHaveBeenCalled();
  await operation.stop();
});

it("retains the active exiting frame until stop has drained the final handoff", async () => {
  const {operation, module} = fixture();
  let finish!: () => void;
  module.pauseMainLoop.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
  const ordinary = operation.checkpoint().catch(error => error as Error);
  await vi.waitFor(() => expect(module.pauseMainLoop).toHaveBeenCalledOnce());
  const final = operation.finalCheckpoint().catch(error => error as Error);
  let stopped = false;
  const stopping = operation.stop(); void stopping.then(() => {stopped = true;});
  await Promise.resolve(); expect(stopped).toBe(false);
  finish();
  expect(await ordinary).toMatchObject({message: "KIRIKIRI_RUNTIME_INVALID_STATE"});
  expect(await final).toMatchObject({message: "KIRIKIRI_RUNTIME_INVALID_STATE"});
  await stopping;
  expect(module._krkr2_host_flush_game_saves).not.toHaveBeenCalled();
  expect(module.resumeMainLoop).not.toHaveBeenCalled();
});

it("captures complete native files and acknowledges only the persisted revision", async () => {
  const {operation, overlay} = fixture();
  const saved = await operation.checkpoint();
  expect(saved.format).toBe("kirikiri-game-save-v1");
  expect(await decodeKirikiriCheckpoint(saved.bytes)).toEqual({progressPaths: ["profile/玩家/slot.png"],
    entries: [{path: "profile/玩家/slot.png", data: Uint8Array.of(4, 2)}]});
  overlay.record("/settings.ksd", Uint8Array.of(1));
  await operation.acknowledge(saved.bytes);
  expect(overlay.availability()).toBe(null);
  const current = await operation.checkpoint();
  await operation.acknowledge(current.bytes);
  expect(overlay.availability()).toBe("UNCHANGED");
  await operation.stop();
});

it.each([false, true])("preserves paused=%s while syncing without running a native save", async paused => {
  const {operation, module} = fixture();
  if (paused) {await operation.pause();}
  module.pauseMainLoop.mockClear(); module.resumeMainLoop.mockClear();
  await operation.checkpoint();
  expect(module.pauseMainLoop).toHaveBeenCalled();
  expect(module.resumeMainLoop).toHaveBeenCalledTimes(paused ? 0 : 1);
  expect(module.krkr2StopMainLoop).not.toHaveBeenCalled();
  await operation.stop();
});

it("does not serialize settings alone as a progress save", async () => {
  const {operation, overlay} = fixture(false); overlay.record("/settings.ksd", Uint8Array.of(1));
  await expect(operation.checkpoint()).rejects.toMatchObject({message: "KIRIKIRI_CHECKPOINT_CREATE_FAILED",
    cause: {message: "KIRIKIRI_NO_SAVE"}});
  await operation.stop();
});

it("waits for the current native frame to drain before reading its files", async () => {
  const {operation, module, overlay} = fixture();
  let finish!: () => void;
  module.pauseMainLoop.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
  const capturing = operation.checkpoint();
  await vi.waitFor(() => expect(module.pauseMainLoop).toHaveBeenCalledOnce());
  overlay.record("/profile/玩家/slot.png", Uint8Array.of(9)); finish();
  expect((await decodeKirikiriCheckpoint((await capturing).bytes)).entries[0]?.data).toEqual(Uint8Array.of(9));
  await operation.stop();
});

it("retains the suspended frame until cancellation has unwound it", async () => {
  const {operation, module} = fixture(); let finish!: () => void;
  const tick = new Promise<void>(resolve => {finish = resolve;});
  module.pauseMainLoop.mockReturnValueOnce(tick);
  const capturing = operation.checkpoint().catch(error => error as Error);
  await vi.waitFor(() => expect(module.pauseMainLoop).toHaveBeenCalledOnce());
  let closed = false; const stopping = operation.stop(); void stopping.then(() => {closed = true;});
  await Promise.resolve(); await Promise.resolve(); expect(closed).toBe(false);
  expect(operation.stop()).toBe(stopping); finish();
  expect(await capturing).toMatchObject({message: "KIRIKIRI_RUNTIME_INVALID_STATE"});
  await stopping; expect(module.resumeMainLoop).not.toHaveBeenCalled();
});

it("cancels the write quiet-period immediately and does not publish a partial save", async () => {
  vi.useFakeTimers(); const {operation, module} = fixture();
  const captured = operation.checkpoint().catch(error => error as Error);
  await vi.advanceTimersByTimeAsync(50); await operation.stop();
  expect(await captured).toMatchObject({message: "KIRIKIRI_RUNTIME_INVALID_STATE"});
  expect(module.resumeMainLoop).not.toHaveBeenCalled();
});

it.each(["no-progress", "acknowledged"])("returns no final checkpoint for %s after draining the core", async mode => {
  const {operation, module, overlay} = fixture(mode === "acknowledged");
  if (mode === "acknowledged") {const saved = await operation.checkpoint(); await operation.acknowledge(saved.bytes);}
  else {overlay.record("/settings.ksd", Uint8Array.of(1));}
  module.pauseMainLoop.mockClear(); module.resumeMainLoop.mockClear();
  expect(await operation.finalCheckpoint()).toBeNull();
  expect(module.pauseMainLoop).toHaveBeenCalledOnce();
  expect(module.resumeMainLoop).not.toHaveBeenCalled();
  await operation.stop();
});

it("serializes final export after an active capture and never restarts the exiting core", async () => {
  const {operation, module, overlay} = fixture(); let finish!: () => void;
  module.pauseMainLoop.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
  const ordinary = operation.checkpoint();
  await vi.waitFor(() => expect(module.pauseMainLoop).toHaveBeenCalledOnce());
  const final = operation.finalCheckpoint(); expect(operation.finalCheckpoint()).toBe(final);
  overlay.record("/profile/玩家/slot.png", Uint8Array.of(8)); finish();
  await ordinary;
  const saved = await final;
  expect(saved).not.toBeNull();
  expect((await decodeKirikiriCheckpoint(saved!.bytes)).entries[0]?.data).toEqual(Uint8Array.of(8));
  expect(module.resumeMainLoop).not.toHaveBeenCalled();
  await operation.resume(); expect(module.resumeMainLoop).not.toHaveBeenCalled();
  await operation.stop();
});

it("drains the original exiting tick before canceling an active final export", async () => {
  const {operation, module} = fixture(); let finish!: () => void;
  module.pauseMainLoop.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
  const final = operation.finalCheckpoint().catch(error => error as Error);
  await vi.waitFor(() => expect(module.pauseMainLoop).toHaveBeenCalledOnce());
  let closed = false; const stopping = operation.stop(); void stopping.then(() => {closed = true;});
  await Promise.resolve(); expect(closed).toBe(false);
  finish();
  expect(await final).toMatchObject({message: "KIRIKIRI_RUNTIME_INVALID_STATE"});
  await stopping; expect(module.resumeMainLoop).not.toHaveBeenCalled();
});

it("allows only the fixed SDK's ExitStatus(0) control flow during final drain", async () => {
  const exit = {name: "ExitStatus", status: 0, message: "Program terminated with exit(0)"};
  const {operation, module} = fixture(); module.pauseMainLoop.mockRejectedValueOnce(exit);
  expect(await operation.finalCheckpoint()).toMatchObject({format: "kirikiri-game-save-v1"});
  expect(module.resumeMainLoop).not.toHaveBeenCalled(); await operation.stop();
  const normal = fixture(); normal.module.pauseMainLoop.mockRejectedValueOnce(exit);
  await expect(normal.operation.checkpoint()).rejects.toMatchObject({message: "KIRIKIRI_CHECKPOINT_CREATE_FAILED", cause: exit});
  await normal.operation.stop();
});

it.each([{name: "ExitStatus", status: 3}, {status: 0}, new WebAssembly.RuntimeError("unreachable")])(
  "does not swallow a failed final drain %#", async failure => {
  const {operation, module} = fixture(); module.pauseMainLoop.mockRejectedValueOnce(failure);
  await expect(operation.finalCheckpoint()).rejects.toMatchObject({message: "KIRIKIRI_CHECKPOINT_FINAL_FAILED", cause: failure});
  expect(module.resumeMainLoop).not.toHaveBeenCalled(); await operation.stop();
});

function fixture(progress = true) {
  const overlay = new KirikiriWriteOverlay();
  if (progress) {
    overlay.observe({phase: "begin", id: 1});
    overlay.record("/profile/玩家/slot.png", Uint8Array.of(4, 2));
    overlay.observe({phase: "end", id: 1, success: true});
  }
  const module = {pauseMainLoop: vi.fn(async (): Promise<void> => undefined), resumeMainLoop: vi.fn(),
    _krkr2_host_flush_game_saves: vi.fn(async () => 0),
    krkr2StopMainLoop: vi.fn(async (active?: Promise<unknown>) => {await active?.catch(() => undefined);})};
  return {operation: createKirikiriCheckpointOperation({module, overlay}), module, overlay};
}
