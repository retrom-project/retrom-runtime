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
});
