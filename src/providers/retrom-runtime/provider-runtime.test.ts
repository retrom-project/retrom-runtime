import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {RuntimeEventV1} from "../../provider/module-api.js";
import type {MountedRuntimeAdapter} from "../../internal-adapter.js";
import {adapterFixture, deferred, hostFixture} from "../../../tests/provider-adapter-fixture.js";
import {wasmEnvelope} from "../../../tests/provider-fixtures.js";
import {createRuntime} from "./module.js";
import {mountTargetAdapter} from "./target-adapter.js";

vi.mock("./target-adapter.js", () => ({mountTargetAdapter: vi.fn()}));
beforeEach(() => {vi.mocked(mountTargetAdapter).mockReset();});
afterEach(() => {document.body.replaceChildren(); vi.useRealTimers();});

describe("Provider-owned lifecycle", () => {
  it.each(["success", "failure", "exit"] as const)("restores input focus only after a successful active resume: %s", async (outcome) => {
    const resume = deferred<void>();
    const canvas = document.createElement("canvas");
    const focus = vi.spyOn(canvas, "focus");
    const adapter = adapterFixture({getCanvas: () => canvas, resume: vi.fn(() => resume.promise)});
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const player = await createRuntime(wasmEnvelope(), hostFixture());
    await player.mount(document.createElement("div"));
    await player.pause();
    expect(focus).not.toHaveBeenCalled();
    const resuming = player.resume();
    const rejected = outcome === "success" ? null : expect(resuming).rejects.toThrow();
    await vi.waitFor(() => expect(adapter.resume).toHaveBeenCalledOnce());
    expect(focus).not.toHaveBeenCalled();
    if (outcome === "exit") {await player.exit();}
    if (outcome === "failure") {resume.reject(new Error("resume failed"));}
    else {resume.resolve();}
    if (rejected) {await rejected;}
    else {await resuming;}
    expect(focus).toHaveBeenCalledTimes(outcome === "success" ? 1 : 0);
    if (outcome === "success") {expect(focus).toHaveBeenCalledWith({preventScroll: true});}
    await player.exit();
  });

  it("never creates a frame or core after exit while restore loading is pending", async () => {
    const restore = deferred<Uint8Array | null>();
    const host = hostFixture({loadRestore: vi.fn(() => restore.promise)});
    const player = await createRuntime(wasmEnvelope(), host);
    const events: RuntimeEventV1[] = [];
    player.subscribe((event) => events.push(event));
    const mounting = player.mount(document.createElement("div"));
    const rejected = expect(mounting).rejects.toMatchObject({name: "AbortError"});
    await player.exit();
    restore.resolve(null);
    await rejected;
    expect(host.mountFrame).not.toHaveBeenCalled();
    expect(mountTargetAdapter).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "FATAL_ERROR")).toBe(false);
    expect(player.getState()).toBe("EXITED");
  });

  it("does not mount an already cancelled Host", async () => {
    const abort = new AbortController();
    abort.abort();
    const host = hostFixture({signal: abort.signal});
    const player = await createRuntime(wasmEnvelope(), host);
    await expect(player.mount(document.createElement("div"))).rejects.toMatchObject({name: "AbortError"});
    expect(host.loadRestore).not.toHaveBeenCalled();
    expect(host.mountFrame).not.toHaveBeenCalled();
    expect(player.getState()).toBe("EXITED");
  });

  it("does not start a core if cancellation wins frame creation", async () => {
    const frame = deferred<Awaited<ReturnType<ReturnType<typeof hostFixture>["mountFrame"]>>>();
    const host = hostFixture({mountFrame: vi.fn(() => frame.promise)});
    const player = await createRuntime(wasmEnvelope(), host);
    const mounting = player.mount(document.createElement("div"));
    const rejected = expect(mounting).rejects.toMatchObject({name: "AbortError"});
    await vi.waitFor(() => expect(host.mountFrame).toHaveBeenCalledOnce());
    await player.exit();
    frame.resolve(await hostFixture().mountFrame(document.createElement("div"), {resourceRole: null}));
    await rejected;
    expect(mountTargetAdapter).not.toHaveBeenCalled();
  });

  it.each(["exit", "abort", "core"] as const)("cleans a late mounted adapter once when %s wins startup", async (cancel) => {
    const pending = deferred<MountedRuntimeAdapter>();
    const adapter = adapterFixture();
    vi.mocked(mountTargetAdapter).mockReturnValue(pending.promise);
    const abort = new AbortController();
    const player = await createRuntime(wasmEnvelope(), hostFixture({signal: abort.signal}));
    const events: RuntimeEventV1[] = [];
    player.subscribe((event) => events.push(event));
    const mounting = player.mount(document.createElement("div"));
    const rejected = expect(mounting).rejects.toMatchObject({name: "AbortError"});
    await vi.waitFor(() => expect(mountTargetAdapter).toHaveBeenCalledOnce());
    expect(player.getState()).toBe("MOUNTING");
    if (cancel === "abort") {abort.abort();}
    else if (cancel === "exit") {await player.exit();}
    else {vi.mocked(mountTargetAdapter).mock.calls[0][2].reportExitRequested();}
    pending.resolve(adapter);
    await rejected;
    await player.exit();
    expect(adapter.exit).toHaveBeenCalledOnce();
    expect(player.getState()).toBe("EXITED");
    expect(events.filter((event) => event.type === "EXIT_REQUESTED")).toHaveLength(cancel === "core" ? 1 : 0);
    expect(events.some((event) => event.type === "FATAL_ERROR")).toBe(false);
    expect(events.some((event) => event.type === "STATE_CHANGED" && event.state === "RUNNING")).toBe(false);
  });

  it("waits for actual readiness and rejects a second mount", async () => {
    const pending = deferred<MountedRuntimeAdapter>();
    const adapter = adapterFixture();
    vi.mocked(mountTargetAdapter).mockReturnValue(pending.promise);
    const player = await createRuntime(wasmEnvelope(), hostFixture());
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(mountTargetAdapter).toHaveBeenCalledOnce());
    expect(player.getState()).toBe("MOUNTING");
    await expect(player.mount(document.createElement("div"))).rejects.toThrow("PLAYER_RUNTIME_CONTRACT_INVALID");
    expect(player.getCanvas()).toBeNull();
    expect(player.getFrameCount()).toBeNull();
    pending.resolve(adapter);
    await mounting;
    expect(player.getState()).toBe("RUNNING");
    await expect(player.screenshot()).resolves.toMatchObject({size: 1, type: "image/png"});
    await player.exit();
  });

  it("shares exit with reentrant Host listeners and disables checkpoints on core exit", async () => {
    const adapter = adapterFixture();
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const player = await createRuntime(wasmEnvelope(), hostFixture());
    const events: RuntimeEventV1[] = [];
    player.subscribe((event) => {
      events.push(event);
      if (event.type === "STATE_CHANGED" && event.state === "EXITING") {void player.exit();}
    });
    await player.mount(document.createElement("div"));
    const reportExit = vi.mocked(mountTargetAdapter).mock.calls[0][2].reportExitRequested;
    reportExit();
    reportExit();
    expect(player.getCheckpointAvailability()).toEqual({available: false, reason: "NOT_READY"});
    await expect(player.checkpoint()).rejects.toMatchObject({name: "AbortError"});
    await player.exit();
    expect(adapter.exit).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.type === "EXIT_REQUESTED")).toHaveLength(1);
    expect(events.filter((event) => event.type === "STATE_CHANGED" && event.state === "EXITED")).toHaveLength(1);
  });

  it("serializes pause before checkpoint and retains the paused state", async () => {
    const pause = deferred<void>();
    const adapter = adapterFixture({pause: vi.fn(() => pause.promise)});
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const player = await createRuntime(wasmEnvelope(), hostFixture());
    await player.mount(document.createElement("div"));
    const pausing = player.pause();
    const saving = player.checkpoint();
    await Promise.resolve();
    expect(adapter.checkpoint).not.toHaveBeenCalled();
    pause.resolve();
    await pausing;
    await expect(saving).resolves.toMatchObject({bytes: Uint8Array.of(4, 5)});
    expect(player.getState()).toBe("PAUSED");
    await player.exit();
  });

  it.each(["pause", "checkpoint"] as const)("lets exit win an in-flight %s without resurrecting the runtime", async (operation) => {
    const pending = deferred<void>();
    const adapter = adapterFixture({
      pause: vi.fn(() => pending.promise),
      checkpoint: vi.fn(async () => {await pending.promise; return {bytes: Uint8Array.of(4, 5), format: "wasm4-state-v1"};}),
    });
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const player = await createRuntime(wasmEnvelope(), hostFixture());
    const events: RuntimeEventV1[] = [];
    player.subscribe((event) => events.push(event));
    await player.mount(document.createElement("div"));
    const action = player[operation]();
    const rejected = expect(action).rejects.toMatchObject({name: "AbortError"});
    await vi.waitFor(() => expect(adapter[operation]).toHaveBeenCalledOnce());
    await player.exit();
    const terminalEvents = events.length;
    pending.resolve();
    await rejected;
    expect(events).toHaveLength(terminalEvents);
    expect(player.getState()).toBe("EXITED");
    expect(adapter.exit).toHaveBeenCalledOnce();
  });

  it.each(["RUNNING", "PAUSED"] as const)("recovers from checkpoint failure to %s", async (state) => {
    const adapter = adapterFixture({checkpoint: vi.fn(async () => {throw new Error("CHECKPOINT_CREATE_FAILED");})});
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const player = await createRuntime(wasmEnvelope(), hostFixture());
    await player.mount(document.createElement("div"));
    if (state === "PAUSED") {await player.pause();}
    await expect(player.checkpoint()).rejects.toThrow("CHECKPOINT_CREATE_FAILED");
    expect(player.getState()).toBe(state);
    expect(player.getCheckpointAvailability().available).toBe(true);
    await player.exit();
  });

  it.each([
    {bytes: new Uint8Array(), format: "wasm4-state-v1"},
    {bytes: Uint8Array.of(1), format: "wrong-format"},
    {bytes: new Uint8Array(132145), format: "wasm4-state-v1"},
  ])("rejects invalid core checkpoint data without failing the running core", async (checkpoint) => {
    const adapter = adapterFixture({checkpoint: vi.fn(async () => checkpoint)});
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const player = await createRuntime(wasmEnvelope(), hostFixture());
    await player.mount(document.createElement("div"));
    await expect(player.checkpoint()).rejects.toThrow("PLAYER_RUNTIME_CONTRACT_INVALID");
    expect(player.getState()).toBe("RUNNING");
    await player.exit();
  });

  it("refuses unavailable checkpoints without calling the core", async () => {
    const adapter = adapterFixture({getCheckpointAvailability: () => ({available: false, blocker: "BUSY"})});
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const player = await createRuntime(wasmEnvelope(), hostFixture());
    await player.mount(document.createElement("div"));
    await expect(player.checkpoint()).rejects.toThrow("PLAYER_RUNTIME_CONTRACT_INVALID");
    expect(adapter.checkpoint).not.toHaveBeenCalled();
    expect(player.getState()).toBe("RUNNING");
    await player.exit();
  });

  it.each(["third-party error", "TYRANOSCRIPT_RUNTIME_TIMEOUT"])("fails once and cleans controls after %s", async (error) => {
    const adapter = adapterFixture({pause: vi.fn(async () => {throw new Error(error);})});
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const player = await createRuntime(wasmEnvelope(), hostFixture());
    const events: RuntimeEventV1[] = [];
    player.subscribe((event) => events.push(event));
    await player.mount(document.createElement("div"));
    const stable = error === "third-party error" ? "RUNTIME_FAILED" : error;
    await expect(player.pause()).rejects.toThrow(stable);
    expect(player.getState()).toBe("FAILED");
    expect(events.filter((event) => event.type === "FATAL_ERROR")).toEqual([{type: "FATAL_ERROR", code: stable}]);
    await player.exit();
    expect(adapter.exit).toHaveBeenCalledOnce();
    expect(player.getState()).toBe("FAILED");
  });

  it("cleans frame surfaces and emits one failure if mount fails", async () => {
    vi.mocked(mountTargetAdapter).mockRejectedValue(new Error("RPG_RUNTIME_UNAVAILABLE"));
    const player = await createRuntime(wasmEnvelope(), hostFixture());
    const events: RuntimeEventV1[] = [];
    player.subscribe((event) => events.push(event));
    await expect(player.mount(document.createElement("div"))).rejects.toThrow("RPG_RUNTIME_UNAVAILABLE");
    expect(player.getState()).toBe("FAILED");
    expect(document.querySelector("iframe")?.contentDocument?.querySelector("[data-retrom-runtime-frame]")).toBeNull();
    expect(events.filter((event) => event.type === "FATAL_ERROR")).toHaveLength(1);
    await player.exit();
    expect(player.getState()).toBe("FAILED");
  });

  it("publishes live availability and stops polling after exit", async () => {
    vi.useFakeTimers();
    let available = false;
    const getAvailability = vi.fn(() => available ? {available: true, blocker: null} as const : {available: false, blocker: "BUSY"} as const);
    const adapter = adapterFixture({getCheckpointAvailability: getAvailability});
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const player = await createRuntime(wasmEnvelope(), hostFixture());
    const events: RuntimeEventV1[] = [];
    player.subscribe((event) => events.push(event));
    await player.mount(document.createElement("div"));
    available = true;
    await vi.advanceTimersByTimeAsync(250);
    expect(events).toContainEqual({type: "CHECKPOINT_AVAILABILITY_CHANGED", availability: {available: true, reason: null}});
    await player.exit();
    const calls = getAvailability.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(getAvailability).toHaveBeenCalledTimes(calls);
  });
});
