import {describe, expect, it, vi} from "vitest";
import type {CheckpointAvailability} from "../../contract.js";
import type {RuntimeEventV1} from "../../provider/module-api.js";
import {adapterFixture, hostFixture} from "../../../tests/provider-adapter-fixture.js";
import {wasmEnvelope} from "../../../tests/provider-fixtures.js";
import {createRetromRuntimePlayer} from "./provider-runtime.js";
import {mountTargetAdapter} from "./target-adapter.js";

vi.mock("./target-adapter.js", () => ({mountTargetAdapter: vi.fn()}));

describe("native save persistence boundary", () => {
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
      expect(adapter.acknowledgeCheckpoint).toHaveBeenCalledWith(payload);
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
    const checkpoint = {bytes: new Uint8Array([3, 4]), format: envelope.runtime.checkpoint!.writeFormat};
    const screenshot = new Blob(["image"], {type: "image/png"});
    const report = vi.mocked(mountTargetAdapter).mock.calls.at(-1)![2].reportExitRequested;
    report({checkpoint, screenshot}); report({checkpoint, screenshot});
    checkpoint.bytes[0] = 9;
    expect(player.getState()).toBe("EXITING");
    expect(events.filter((event) => event.type === "EXIT_REQUESTED")).toEqual([
      {type: "EXIT_REQUESTED", finalSnapshot: {checkpoint: {...checkpoint, bytes: new Uint8Array([3, 4]), metadata: null}, screenshot}},
    ]);
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
