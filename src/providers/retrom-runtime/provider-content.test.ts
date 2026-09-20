import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {adapterFixture, deferred, hostFixture} from "../../../tests/provider-adapter-fixture.js";
import {wasmEnvelope} from "../../../tests/provider-fixtures.js";
import {bootstrapContentSession} from "../../content-io/bootstrap.js";
import type {ContentSessionClient} from "../../content-io/client.js";
import {ContentIOError} from "../../content-io/errors.js";
import {createRuntime} from "./module.js";
import {mountTargetAdapter} from "./target-adapter.js";
vi.mock("./target-adapter.js", () => ({mountTargetAdapter: vi.fn()}));
vi.mock("../../content-io/bootstrap.js", () => ({bootstrapContentSession: vi.fn()}));
beforeEach(() => {vi.spyOn(window, "focus").mockImplementation(() => {}); vi.mocked(mountTargetAdapter).mockReset(); vi.mocked(bootstrapContentSession).mockReset();});
afterEach(() => {document.body.replaceChildren(); vi.restoreAllMocks();});
function sessionFixture() {
  let closed = false;
  const session = {read: () => {if (closed) {throw new ContentIOError("ABORTED");} return 17;},
    fail: vi.fn(() => {closed = true;}), close: vi.fn(async () => {closed = true;})};
  vi.mocked(bootstrapContentSession).mockResolvedValue(session as unknown as ContentSessionClient); return session;
}
it("[BR-08] UNIT/provider-normal [X-15] UNIT/provider-normal preserves content while native stop is pending, then closes once", async () => {
  const session = sessionFixture(), stop = deferred<void>();
  const adapter = adapterFixture({exit: vi.fn(async () => {expect(session.read()).toBe(17); await stop.promise; expect(session.read()).toBe(17);})});
  vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
  const player = await createRuntime(wasmEnvelope(), hostFixture());
  expect(bootstrapContentSession).not.toHaveBeenCalled(); await player.mount(document.createElement("div"));
  expect(vi.mocked(mountTargetAdapter).mock.calls[0][2].contentSession).toBe(session);
  const exit = player.exit(); await vi.waitFor(() => expect(adapter.exit).toHaveBeenCalledOnce());
  expect(session.close).not.toHaveBeenCalled(); expect(session.fail).not.toHaveBeenCalled(); expect(session.read()).toBe(17);
  stop.resolve(); await exit; await player.exit(); expect(session.close).toHaveBeenCalledOnce(); expect(() => session.read()).toThrow("ABORTED");
});
it("[BR-08] UNIT/provider-force [X-15] UNIT/provider-force [X-21] UNIT/provider-force Host abort revokes content before native stop", async () => {
  const session = sessionFixture(), abort = new AbortController();
  const adapter = adapterFixture({exit: vi.fn(async () => {expect(() => session.read()).toThrow("ABORTED");})});
  vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
  const player = await createRuntime(wasmEnvelope(), hostFixture({signal: abort.signal})); await player.mount(document.createElement("div"));
  abort.abort(); await player.exit(); expect(session.fail).toHaveBeenCalledOnce(); expect(adapter.exit).toHaveBeenCalledOnce();
});
it("[X-16] UNIT/provider-core-failure core initialization failure revokes and releases Session", async () => {
  const session = sessionFixture(); vi.mocked(mountTargetAdapter).mockRejectedValue(new Error("RUNTIME_FAILED"));
  const player = await createRuntime(wasmEnvelope(), hostFixture());
  await expect(player.mount(document.createElement("div"))).rejects.toThrow("RUNTIME_FAILED");
  expect(session.fail).toHaveBeenCalledOnce(); expect(session.close).toHaveBeenCalledOnce(); expect(player.getState()).toBe("FAILED");
});
it("[X-16] UNIT/provider-late-worker exiting during Worker bootstrap closes late readiness without starting core", async () => {
  const session = sessionFixture(), pending = deferred<ContentSessionClient>(); vi.mocked(bootstrapContentSession).mockReturnValue(pending.promise);
  const player = await createRuntime(wasmEnvelope(), hostFixture()), mounting = player.mount(document.createElement("div"));
  const rejected = expect(mounting).rejects.toMatchObject({name: "AbortError"});
  await vi.waitFor(() => expect(bootstrapContentSession).toHaveBeenCalledOnce()); await player.exit();
  pending.resolve(session as unknown as ContentSessionClient); await rejected;
  expect(session.close).toHaveBeenCalledOnce(); expect(mountTargetAdapter).not.toHaveBeenCalled();
});
it("[BR-09] UNIT/provider-worker-failure propagates one terminal error and closes native resources", async () => {
  const session = sessionFixture(), adapter = adapterFixture(); vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
  const player = await createRuntime(wasmEnvelope(), hostFixture()), fatal: string[] = [];
  player.subscribe(event => {if (event.type === "FATAL_ERROR") {fatal.push(event.code);}}); await player.mount(document.createElement("div"));
  const notify = vi.mocked(bootstrapContentSession).mock.calls[0][0].onFailure!;
  notify(new ContentIOError("IDENTITY_CHANGED")); notify(new ContentIOError("INTERNAL")); await player.exit();
  expect(fatal).toEqual(["CONTENT_IO_IDENTITY_CHANGED"]); expect(adapter.exit).toHaveBeenCalledOnce(); expect(session.close).toHaveBeenCalledOnce();
});

it("[BR-07] UNIT/provider-native-safe-point waits for the adapter pause boundary before checkpointing a pending native read", async () => {
  const session = sessionFixture(), nativeRead = deferred<void>();
  const adapter = adapterFixture({pause: vi.fn(async () => {await nativeRead.promise; expect(session.read()).toBe(17);})});
  vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
  const player = await createRuntime(wasmEnvelope(), hostFixture()); await player.mount(document.createElement("div"));
  const pausing = player.pause(), saving = player.checkpoint();
  await vi.waitFor(() => expect(adapter.pause).toHaveBeenCalledOnce());
  expect(adapter.checkpoint).not.toHaveBeenCalled(); expect(session.close).not.toHaveBeenCalled(); expect(session.fail).not.toHaveBeenCalled();
  nativeRead.resolve(); await pausing; const saved = await saving;
  expect(saved.bytes.length).toBeGreaterThan(0); expect(adapter.checkpoint).toHaveBeenCalledOnce();
  expect(player.getState()).toBe("PAUSED"); await player.resume(); expect(adapter.resume).toHaveBeenCalledOnce();
  expect(player.getState()).toBe("RUNNING"); await player.exit();
});
it("[X-16] UNIT/provider-late-adapter closes an adapter returned after mount cancellation without publishing RUNNING", async () => {
  const session = sessionFixture(), pending = deferred<ReturnType<typeof adapterFixture>>(), adapter = adapterFixture();
  vi.mocked(mountTargetAdapter).mockReturnValue(pending.promise);
  const player = await createRuntime(wasmEnvelope(), hostFixture()), states: string[] = [];
  player.subscribe(event => {if (event.type === "STATE_CHANGED") {states.push(event.state);}});
  const mounting = player.mount(document.createElement("div")), rejected = expect(mounting).rejects.toMatchObject({name: "AbortError"});
  await vi.waitFor(() => expect(mountTargetAdapter).toHaveBeenCalledOnce()); await player.exit(); pending.resolve(adapter); await rejected;
  expect(adapter.exit).toHaveBeenCalledOnce(); expect(session.close).toHaveBeenCalledOnce(); expect(states).not.toContain("RUNNING");
});
it.each(["ABI_MISMATCH", "CHECKSUM_MISMATCH"] as const)("[BR-12] UNIT/provider-bootstrap-%s never starts the core when verified bootstrap fails", async name => {
  sessionFixture(); vi.mocked(bootstrapContentSession).mockRejectedValue(new ContentIOError(name));
  const player = await createRuntime(wasmEnvelope(), hostFixture());
  await expect(player.mount(document.createElement("div"))).rejects.toThrow(name);
  expect(mountTargetAdapter).not.toHaveBeenCalled(); expect(player.getState()).toBe("FAILED"); await player.exit();
});
