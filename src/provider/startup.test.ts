import {expect, it, vi} from "vitest";
import type {ContentSessionAccess} from "./content-inputs.js";
import {StartupTasks} from "./startup.js";
import {startupContent} from "./startup-content.js";
import {deferred} from "../../tests/provider-adapter-fixture.js";

it("keeps 100 percent active until the operation returns and preserves parallel identities", async () => {
  const emit = vi.fn(), pending = deferred<string>();
  const tasks = new StartupTasks(emit, new AbortController().signal);
  const result = tasks.run("GAME_CONTENT", task => {task.progress(100, 100); return pending.promise;});
  const other = tasks.begin("BIOS"); other.complete();
  const gameEvents = emit.mock.calls.map(([event]) => event.task).filter(task => task.kind === "GAME_CONTENT");
  expect(gameEvents.map(task => task.state)).toEqual(["RUNNING", "RUNNING"]);
  expect(gameEvents.at(-1).progress).toEqual({loadedBytes: 100, totalBytes: 100});
  pending.resolve("ready"); expect(await result).toBe("ready");
  expect(emit.mock.calls.at(-1)?.[0].task.state).toBe("COMPLETED");
  expect(new Set(emit.mock.calls.map(([event]) => event.task.id)).size).toBe(2);
});

it("suppresses late events after cancellation without losing returned cleanup resources", async () => {
  const abort = new AbortController(), emit = vi.fn(), pending = deferred<object>();
  const tasks = new StartupTasks(emit, abort.signal), resource = {};
  const result = tasks.run("GAME_START", () => pending.promise);
  abort.abort(); tasks.stop(); pending.resolve(resource);
  expect(await result).toBe(resource);
  expect(emit).toHaveBeenCalledOnce();
});

it("reports content completion after materialization and preserves the original progress callback", async () => {
  const pending = deferred<never>(), emit = vi.fn(), report = vi.fn();
  const materialize = vi.fn<ContentSessionAccess["materialize"]>((_id, _request, _signal, progress) => {
    progress?.({readyBytes: 8, totalBytes: 8, networkBytes: 0, attempt: 0, committed: false}); return pending.promise;
  });
  const raw = {open: vi.fn(async () => ({id: "file", close: vi.fn()})), materialize, closeFile: vi.fn()};
  const session = startupContent(raw as never, new StartupTasks(emit, new AbortController().signal));
  await session.open({purpose: "FIRMWARE"} as never, {mode: "EAGER"} as never);
  const result = session.materialize("file", {kind: "BYTES", maxBytes: 8}, undefined, report);
  const rejected = expect(result).rejects.toThrow("commit failed");
  expect(emit.mock.calls.at(-1)?.[0].task).toMatchObject({kind: "BIOS", state: "RUNNING", progress: {loadedBytes: 8, totalBytes: 8}});
  expect(report).toHaveBeenCalledOnce(); pending.reject(new Error("commit failed")); await rejected;
  expect(emit.mock.calls.at(-1)?.[0].task.state).toBe("FAILED");
});
