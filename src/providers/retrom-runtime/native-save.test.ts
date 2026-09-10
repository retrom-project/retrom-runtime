import {decodeStoredCheckpoint} from "../../provider/checkpoint-storage.js";
import {describe, expect, it, vi} from "vitest";
import type {CheckpointAvailability} from "../../contract.js";
import type {RuntimeEventV1} from "../../provider/module-api.js";
import {adapterFixture, hostFixture} from "../../../tests/provider-adapter-fixture.js";
import {wasmEnvelope} from "../../../tests/provider-fixtures.js";
import {createRetromRuntimePlayer} from "./provider-runtime.js";
import {mountTargetAdapter} from "./target-adapter.js";

vi.mock("./target-adapter.js", () => ({mountTargetAdapter: vi.fn()}));

describe("native save persistence boundary", () => {
  it("rejects an unknown native-save data kind", async () => {
    const availability = {available: true, blocker: null,
      save: {capture: "IN_GAME", restore: "AUTOMATIC", captureAvailable: false, dataKind: "UNKNOWN"}};
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapterFixture({
      getCheckpointAvailability: () => availability as CheckpointAvailability,
    }));
    const envelope = wasmEnvelope(); envelope.runtime.checkpoint!.semantics = "GAME_SAVE";
    const player = createRetromRuntimePlayer(envelope, hostFixture(), {});
    try {
      await player.mount(document.createElement("div"));
      expect(player.getCheckpointAvailability()).toEqual({available: false, reason: "FAILED"});
    } finally {await player.exit();}
  });
  it("publishes a storage data-kind change without changing save eligibility", async () => {
    let availability: CheckpointAvailability = {available: true, blocker: null, revision: "1",
      save: {capture: "IN_GAME", restore: "AUTOMATIC", captureAvailable: false, dataKind: "PROGRESS"}};
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapterFixture({getCheckpointAvailability: () => availability}));
    const envelope = wasmEnvelope(); envelope.runtime.checkpoint!.semantics = "GAME_SAVE";
    const player = createRetromRuntimePlayer(envelope, hostFixture(), {});
    const events: RuntimeEventV1[] = []; player.subscribe((event) => events.push(event));
    try {
      await player.mount(document.createElement("div"));
      events.length = 0;
      availability = {...availability, save: {...availability.save!, dataKind: "STORAGE"}};
      expect(player.getCheckpointAvailability()).toMatchObject({available: true, save: {dataKind: "STORAGE"}});
      expect(events).toEqual([{type: "CHECKPOINT_AVAILABILITY_CHANGED",
        availability: {available: true, reason: null, revision: "1", save: availability.save}}]);
      await expect(player.checkpoint()).resolves.toBeDefined();
    } finally {await player.exit();}
  });
  it("forwards revisions without acknowledging exports and confirms only the explicit payload", async () => {
    let availability: CheckpointAvailability = {available: true, blocker: null, revision: "1"};
    const adapter = adapterFixture({
      getCheckpointAvailability: () => availability,
      acknowledgeCheckpoint: vi.fn(async () => {availability = {available: false, blocker: "UNCHANGED"};}),
    });
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const envelope = wasmEnvelope();
    if (!envelope.runtime.checkpoint) {throw new Error("fixture checkpoint missing");}
    envelope.runtime.checkpoint.semantics = "GAME_SAVE";
    const player = createRetromRuntimePlayer(envelope, hostFixture(), {});
    const events: RuntimeEventV1[] = [];
    player.subscribe((event) => events.push(event));
    try {
      await player.mount(document.createElement("div"));
      const payload = await player.checkpoint();
      expect(adapter.acknowledgeCheckpoint).not.toHaveBeenCalled();
      expect(player.getCheckpointAvailability()).toEqual({available: true, reason: null, revision: "1"});
      availability = {available: true, blocker: null, revision: "2"};
      player.getCheckpointAvailability();
      expect(events.at(-1)).toMatchObject({type: "CHECKPOINT_AVAILABILITY_CHANGED", availability: {revision: "2"}});
      await player.acknowledgeCheckpoint?.(payload);
      expect(adapter.acknowledgeCheckpoint).toHaveBeenCalledWith({bytes: Uint8Array.of(4, 5), format: "wasm4-state-v1", metadata: null});
      expect(player.getCheckpointAvailability()).toEqual({available: false, reason: "UNCHANGED"});
    } finally {await player.exit();}
  });
  it("exposes capture capability before any save and separates explicit capture from synchronization export", async () => {
    let availability: CheckpointAvailability = {available: false, blocker: "NO_SAVE",
      save: {capture: "RUNTIME", restore: "AUTOMATIC", captureAvailable: true}};
    const adapter = adapterFixture({getCheckpointAvailability: () => availability});
    vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const envelope = wasmEnvelope(); envelope.runtime.checkpoint!.semantics = "GAME_SAVE";
    const player = createRetromRuntimePlayer(envelope, hostFixture(), {});
    const events: RuntimeEventV1[] = []; player.subscribe((event) => events.push(event));
    try {
      await player.mount(document.createElement("div"));
      expect(player.getCheckpointAvailability()).toMatchObject({save: {captureAvailable: true}});
      await player.checkpoint({intent: "CAPTURE"});
      expect(adapter.checkpoint).toHaveBeenLastCalledWith({intent: "CAPTURE"});
      await expect(player.checkpoint({intent: "EXPORT"})).rejects.toThrow("PLAYER_RUNTIME_CONTRACT_INVALID");
      availability = {available: true, blocker: null, revision: "content", save: availability.save};
      await player.checkpoint({intent: "EXPORT"});
      expect(adapter.checkpoint).toHaveBeenLastCalledWith({intent: "EXPORT"});
      availability = {...availability, save: {...availability.save!, captureAvailable: false}};
      player.getCheckpointAvailability();
      expect(events.at(-1)).toMatchObject({type: "CHECKPOINT_AVAILABILITY_CHANGED", availability: {save: {captureAvailable: false}}});
    } finally {await player.exit();}
  });

  it("hands off a detached final native snapshot once while immediately closing the runtime", async () => {
    const adapter = adapterFixture(); vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const envelope = wasmEnvelope(); envelope.runtime.checkpoint!.semantics = "GAME_SAVE";
    const player = createRetromRuntimePlayer(envelope, hostFixture(), {});
    const events: RuntimeEventV1[] = []; player.subscribe((event) => events.push(event));
    await player.mount(document.createElement("div"));
    const checkpoint = {bytes: new Uint8Array([3, 4]), format: "wasm4-state-v1"};
    const screenshot = new Blob(["image"], {type: "image/png"});
    const report = vi.mocked(mountTargetAdapter).mock.calls.at(-1)![2].reportExitRequested;
    report({checkpoint, screenshot}); report({checkpoint, screenshot});
    checkpoint.bytes[0] = 9;
    expect(player.getState()).toBe("EXITING");
    await vi.waitFor(() => expect(events.filter(event => event.type === "EXIT_REQUESTED")).toHaveLength(1));
    const event = events.find(event => event.type === "EXIT_REQUESTED")!;
    if (event.type !== "EXIT_REQUESTED" || !event.finalSnapshot) {throw Error("final snapshot missing");}
    expect(event.finalSnapshot.screenshot).toBe(screenshot);
    const stored = event.finalSnapshot.checkpoint;
    expect(stored.format).toBe("wasm4-state-v1-storage-v1");
    expect(await decodeStoredCheckpoint(stored.bytes, stored.format, 132144)).toEqual(new Uint8Array([3, 4]));
    await player.exit(); expect(adapter.exit).toHaveBeenCalledOnce();
  });

  it("rejects an invalid final save without keeping an ended core alive", async () => {
    const adapter = adapterFixture(); vi.mocked(mountTargetAdapter).mockResolvedValue(adapter);
    const envelope = wasmEnvelope(); envelope.runtime.checkpoint!.semantics = "GAME_SAVE";
    const host = hostFixture(); const player = createRetromRuntimePlayer(envelope, host, {});
    const events: RuntimeEventV1[] = []; player.subscribe((event) => events.push(event));
    await player.mount(document.createElement("div"));
    vi.mocked(mountTargetAdapter).mock.calls.at(-1)![2].reportExitRequested({
      checkpoint: {format: "wrong", bytes: new Uint8Array([1])}, screenshot: null,
    });
    expect(events).toContainEqual({type: "EXIT_REQUESTED"});
    expect(host.reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({code: "RETROM_RUNTIME_FINAL_SAVE_INVALID"}));
    await player.exit(); expect(adapter.exit).toHaveBeenCalledOnce();
  });

});
