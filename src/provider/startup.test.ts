import {expect, it, vi} from "vitest";
import type {ContentSessionAccess} from "./content-inputs.js";
import {StartupTasks} from "./startup.js";
import {startupContent} from "./startup-content.js";
import {deferred} from "../../tests/provider-adapter-fixture.js";

it("marks an awaited summary explicitly without marking independent work or completing it early", async () => {
  const emit = vi.fn(), pending = deferred<void>();
  const tasks = new StartupTasks(emit, new AbortController().signal);
  const result = tasks.run("GAME_START", () => pending.promise, {summary: true});
  tasks.begin("BIOS");
  expect(emit.mock.calls[0][0].task).toMatchObject({summary: true, state: "RUNNING"});
  expect(emit.mock.calls[1][0].task.summary).toBeUndefined();
  pending.resolve(); await result;
  expect(emit.mock.calls.at(-1)?.[0].task).toMatchObject({summary: true, state: "COMPLETED"});
});

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

it("groups successive project files until adapter readiness instead of announcing each file as ready", async () => {
  const emit = vi.fn(), tasks = new StartupTasks(emit, new AbortController().signal);
  const raw = {open: vi.fn(async () => ({id: "file", close: vi.fn()})), materialize: vi.fn(), closeFile: vi.fn()};
  const session = startupContent(raw as never, tasks);
  for (let index = 0; index < 60; index++) {
    await session.open({purpose: "GAME", identity: {kind: "INDEX_ENTRY", projectDigest: "project", logicalPath: `data/${index}.json`}} as never, {mode: "ON_OPEN"} as never);
  }
  expect(emit.mock.calls.map(([event]) => [event.task.kind, event.task.state])).toEqual([["CONTENT_MOUNT", "RUNNING"]]);
  tasks.completePreparations();
  expect(emit.mock.calls.map(([event]) => event.task.state)).toEqual(["RUNNING", "COMPLETED"]);
  expect(raw.open).toHaveBeenCalledTimes(60);
});

it("does not turn a grouped content failure or cancellation into successful readiness", async () => {
  const emit = vi.fn(), abort = new AbortController(), tasks = new StartupTasks(emit, abort.signal);
  const raw = {open: vi.fn(async () => {throw new Error("read failed");}), materialize: vi.fn(), closeFile: vi.fn()};
  const session = startupContent(raw as never, tasks);
  await expect(session.open({purpose: "GAME", identity: {kind: "INDEX_ENTRY"}} as never, {mode: "ON_OPEN"} as never)).rejects.toThrow("read failed");
  tasks.completePreparations();
  expect(emit.mock.calls.map(([event]) => event.task.state)).toEqual(["RUNNING", "FAILED"]);
  abort.abort(); tasks.stop();
  expect(emit.mock.calls.some(([event]) => event.task.state === "COMPLETED")).toBe(false);
});

it("forwards indexed materialization progress without treating one file as the whole preparation", async () => {
  const emit = vi.fn(), report = vi.fn(), tasks = new StartupTasks(emit, new AbortController().signal);
  const progress = {readyBytes: 8, totalBytes: 8, networkBytes: 8, attempt: 0, committed: true} as const;
  const raw = {open: vi.fn(async () => ({id: "file", close: vi.fn()})), closeFile: vi.fn(),
    materialize: vi.fn<ContentSessionAccess["materialize"]>(async (_id, _request, _signal, callback) => {
      callback?.(progress); return {kind: "BYTES", bytes: new Uint8Array(8)} as never;
    })};
  const session = startupContent(raw as never, tasks);
  await session.open({purpose: "GAME", identity: {kind: "INDEX_ENTRY"}} as never, {mode: "EAGER"} as never);
  await session.materialize("file", {kind: "BYTES", maxBytes: 8}, undefined, report);
  expect(report).toHaveBeenCalledWith(progress);
  expect(emit.mock.calls.map(([event]) => event.task)).toEqual([{id: "provider:1", kind: "CONTENT_MOUNT", state: "RUNNING", progress: null}]);
  tasks.completePreparations();
  expect(emit.mock.calls.at(-1)?.[0].task.state).toBe("COMPLETED");
});

it("does not complete cancelled grouped work when its last read returns late", async () => {
  const emit = vi.fn(), abort = new AbortController(), tasks = new StartupTasks(emit, abort.signal), pending = deferred<object>();
  const result = tasks.runPreparation("CONTENT_MOUNT", () => pending.promise);
  abort.abort(); tasks.stop(); pending.resolve({}); await result; tasks.completePreparations();
  expect(emit.mock.calls.map(([event]) => event.task.state)).toEqual(["RUNNING"]);
});
