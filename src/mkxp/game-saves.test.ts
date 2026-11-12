import {afterEach, expect, it, vi} from "vitest";
import {decodeRpgCheckpoint} from "../checkpoint.js";
import {createHarness, mkxpConfig, mountMkxp} from "../../tests/mkxp-adapter-fixture.js";

const root = "/home/web_user/retroarch/userdata/saves/mkxp-z/Saves/Game-";
afterEach(() => {vi.useRealTimers(); document.body.replaceChildren();});
it.each([1, 2, 3] as const)("RGSS %s exports all native files, imports before boot, and acknowledges the exact export", async rgssVersion => {
  const first = createHarness(), config = {...mkxpConfig(), rgssVersion};
  const player = await mountMkxp(config, first.target, null, first.dependencies);
  expect(player.getCheckpointAvailability()).toMatchObject({available: false, blocker: "NO_SAVE", save: {capture: "IN_GAME", restore: "IN_GAME"}});
  const extension = ["rxdata", "rvdata", "rvdata2"][rgssVersion - 1];
  first.runtime.getEmscriptenFS().mkdirTree(root);
  first.runtime.getEmscriptenFS().writeFile(`${root}/Save01.${extension}`, Uint8Array.of(1, 2));
  first.runtime.getEmscriptenFS().writeFile(`${root}/Save02.${extension}`, Uint8Array.of(3, 4));
  first.runtime.getEmscriptenFS().writeFile(`${root}/Common.dat`, Uint8Array.of(9));
  const captured = await player.checkpoint();
  const engine = rgssVersion === 1 ? "RPGXP" : rgssVersion === 2 ? "RPGVX" : "RPGVXAce";
  const bundle = await decodeRpgCheckpoint(captured.bytes, engine);
  expect(bundle.entries).toHaveLength(3);
  first.runtime.getEmscriptenFS().writeFile(`${root}/Save02.${extension}`, Uint8Array.of(5, 6));
  await player.acknowledgeCheckpoint!(captured);
  expect(player.getCheckpointAvailability()).toMatchObject({available: true});
  const latest = await player.checkpoint(); await player.acknowledgeCheckpoint!(latest);
  expect(player.getCheckpointAvailability()).toMatchObject({available: false, blocker: "UNCHANGED"});
  const second = createHarness();
  second.runtime.start.mockImplementation(async () => {
    expect(second.files.get(`${root}/Save01.${extension}`)).toEqual(Uint8Array.of(1, 2));
    expect(second.files.get(`${root}/Save02.${extension}`)).toEqual(Uint8Array.of(5, 6));
    expect(second.files.get(`${root}/Common.dat`)).toEqual(Uint8Array.of(9));
    second.runtime.observation.frames = 1;
  });
  const restored = await mountMkxp(config, second.target, latest.bytes, second.dependencies);
  expect(restored.getCheckpointAvailability()).toMatchObject({available: false, blocker: "UNCHANGED"});
  expect(second.runtime.requestState).not.toHaveBeenCalled();
  second.runtime.observation.frames = 2; expect(restored.getFrameCount()).toBe(2);
  await player.exit(); await restored.exit();
});

it("exports the final native files when the game owns its exit", async () => {
  const first = createHarness(), report = vi.fn();
  const player = await mountMkxp(mkxpConfig(), first.target, null, first.dependencies, () => {}, () => {}, report);
  first.runtime.getEmscriptenFS().mkdirTree(root);
  first.runtime.getEmscriptenFS().writeFile(`${root}/Save01.rxdata`, Uint8Array.of(7));
  first.prepareOptions!.emscriptenModule.onExit(0);
  await vi.advanceTimersByTimeAsync(0);
  await vi.waitFor(() => expect(report).toHaveBeenCalledOnce());
  const data = await decodeRpgCheckpoint(report.mock.calls[0][0].checkpoint.bytes, "RPGXP");
  expect(data.entries[0].data).toEqual(Uint8Array.of(7));
  await player.exit();
});
