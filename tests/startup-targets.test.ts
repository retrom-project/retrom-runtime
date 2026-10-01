import {afterEach, describe, expect, it, vi} from "vitest";
import {retromRuntimeProviderDefinition} from "../src/providers/retrom-runtime/catalog.js";
import {emulatorJsProviderDefinition} from "../src/providers/emulatorjs/catalog.js";
import {createRetromRuntimePlayer} from "../src/providers/retrom-runtime/provider-runtime.js";
import {createEmulatorJsPlayer} from "../src/providers/emulatorjs/provider-runtime.js";
import {mountTargetAdapter} from "../src/providers/retrom-runtime/target-adapter.js";
import {adapterFixture, deferred, hostFixture} from "./provider-adapter-fixture.js";
import {targetEnvelope} from "./provider-fixtures.js";
import {launchEnvelope} from "./emulatorjs-provider-fixtures.js";

vi.mock("../src/content-io/bootstrap.js", () => ({bootstrapContentSession: vi.fn(async () => ({close: vi.fn(async () => {}), fail: vi.fn()}))}));
vi.mock("../src/providers/retrom-runtime/target-adapter.js", () => ({mountTargetAdapter: vi.fn()}));
afterEach(() => {vi.mocked(mountTargetAdapter).mockReset(); document.body.replaceChildren();});

describe("shared startup events cover the complete Target catalog", () => {
  it.each(retromRuntimeProviderDefinition.targets.map(target => target.id))("retrom-runtime/%s keeps a task active until its adapter is ready", async targetId => {
    const pending = deferred<ReturnType<typeof adapterFixture>>();
    vi.mocked(mountTargetAdapter).mockReturnValue(pending.promise);
    const player = createRetromRuntimePlayer(targetEnvelope(targetId), hostFixture(), {});
    const events: Array<{type: string; task?: {kind: string; state: string}}> = [];
    player.subscribe(event => events.push(event));
    const mounting = player.mount(document.createElement("div"));
    await vi.waitFor(() => expect(mountTargetAdapter).toHaveBeenCalledOnce());
    expect(events).toContainEqual(expect.objectContaining({type: "LOAD_TASK", task: expect.objectContaining({kind: "GAME_START", state: "RUNNING", summary: true})}));
    expect(player.getState()).toBe("MOUNTING");
    pending.resolve(adapterFixture());
    await mounting;
    expect(events).toContainEqual(expect.objectContaining({type: "LOAD_TASK", task: expect.objectContaining({kind: "GAME_START", state: "COMPLETED"})}));
    await player.exit();
  });

  it.each(emulatorJsProviderDefinition.targets)("emulatorjs/$id reports frame preparation before upstream loading", async target => {
    const frame = deferred<Awaited<ReturnType<ReturnType<typeof hostFixture>["mountFrame"]>>>();
    const host = hostFixture({mountFrame: () => frame.promise});
    const envelope = launchEnvelope();
    envelope.runtime.targetId = target.id;
    const asset = {[target.implementation.coreAssetPath]: {sha256: target.implementation.coreSha256, sizeBytes: target.implementation.coreSizeBytes}};
    const player = await createEmulatorJsPlayer(envelope, host, asset);
    const events: Array<{type: string; task?: {kind: string; state: string}}> = [];
    player.subscribe(event => events.push(event));
    const mounting = player.mount(document.createElement("div"));
    const rejected = expect(mounting).rejects.toThrow();
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({type: "LOAD_TASK", task: expect.objectContaining({kind: "ENVIRONMENT", state: "RUNNING"})})));
    await player.exit();
    frame.resolve(await hostFixture().mountFrame(document.createElement("div"), {resourceRole: null}));
    await rejected;
    expect(player.getState()).not.toBe("RUNNING");
  });
});
