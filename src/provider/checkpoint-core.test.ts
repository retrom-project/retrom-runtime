import {expect, it, vi} from "vitest";
import {mountCheckpointCore} from "./checkpoint-core.js";

function fixture() {
  const core = {canvas: document.createElement("canvas"), checkpoint: vi.fn(async () => Uint8Array.of(1)),
    frameCount: () => 1, pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => new Blob(["image"])), stop: vi.fn(async () => undefined)};
  const reader = {close: vi.fn(async () => undefined)}, closeModule = vi.fn();
  const start = vi.fn(async () => ({core, reader}));
  return {core, reader, options: {start, closeModule, checkpointFormat: "test-state-v1", errorPrefix: "TEST_CORE"}};
}

it("refuses a checkpoint that completes after its core session has exited", async () => {
  const {core, reader, options} = fixture();
  let complete: (value: Uint8Array<ArrayBuffer>) => void = () => undefined;
  core.checkpoint.mockReturnValue(new Promise(resolve => {complete = resolve;}));
  const session = await mountCheckpointCore(options), pending = session.checkpoint();
  await session.exit(); complete(Uint8Array.of(1, 2));
  await expect(pending).rejects.toThrow("TEST_CORE_RUNTIME_EXITED");
  expect(session.getCanvas()).toBeNull(); expect(session.getFrameCount()).toBeNull();
  expect(reader.close).toHaveBeenCalledOnce(); expect(options.closeModule).toHaveBeenCalledOnce();
});

it("releases the reader and module even when core shutdown fails", async () => {
  const {core, reader, options} = fixture();
  core.stop.mockRejectedValue(new Error("STOP_FAILED"));
  const session = await mountCheckpointCore(options);
  await expect(session.exit()).rejects.toThrow("STOP_FAILED");
  expect(reader.close).toHaveBeenCalledOnce(); expect(options.closeModule).toHaveBeenCalledOnce();
  await session.exit(); expect(core.stop).toHaveBeenCalledOnce();
  expect(session.getCheckpointAvailability()).toEqual({available: false, blocker: "NOT_READY"});
});

it("releases only the loaded module when starting the core fails", async () => {
  const {reader, options} = fixture();
  options.start.mockRejectedValue(new Error("START_FAILED"));
  await expect(mountCheckpointCore(options)).rejects.toThrow("START_FAILED");
  expect(options.closeModule).toHaveBeenCalledOnce(); expect(reader.close).not.toHaveBeenCalled();
});

it("closes an aborted just-created core before exposing the session", async () => {
  const {core, reader, options} = fixture(), controller = new AbortController();
  options.start.mockImplementation(async () => {controller.abort(); return {core, reader};});
  await expect(mountCheckpointCore({...options, signal: controller.signal})).rejects.toMatchObject({name: "AbortError"});
  expect(core.stop).toHaveBeenCalledOnce(); expect(reader.close).toHaveBeenCalledOnce();
  expect(options.closeModule).toHaveBeenCalledOnce();
});
