import {afterEach, expect, it, vi} from "vitest";
import {decodeRpgCheckpoint} from "../checkpoint.js";
import {mountEasyRpg} from "./adapter.js";
import {rpgSaveFileSystem} from "../../tests/rpg-save-files-fixture.js";

afterEach(() => {document.body.replaceChildren(); document.head.replaceChildren(); vi.restoreAllMocks();});
it.each(["RPG2000", "RPG2003"] as const)("%s imports all original slots before starting at the title and tracks later native saves", async engine => {
  const setup = async (payload: Uint8Array | null) => {
    const {fs, files} = rpgSaveFileSystem(), target = document.createElement("div"); document.body.append(target);
    const create = vi.fn(async (options: {runtimeRestoreFiles?: Array<{path: string; bytes: Uint8Array}>;
      onRuntimeInitialized?(this: {FS: typeof fs}): void}) => {
      fs.mkdirTree("Save");
      if (payload) {
        // IDBFS has already loaded this run's later files before the engine's main starts.
        fs.mkdirTree("Save/later/empty");
        fs.writeFile("Save/Save03.lsd", Uint8Array.of(7));
      }
      for (const file of options.runtimeRestoreFiles ?? []) {fs.writeFile(file.path, file.bytes);}
      options.onRuntimeInitialized?.call({FS: fs});
      return {FS: fs, canvas: document.createElement("canvas"), runtimeFileSystemReady: true,
        initApi() {}, pauseMainLoop() {}, resumeMainLoop() {},
        api: {runtimeState: () => JSON.stringify({engine, ready: false, canCheckpoint: false, frameCount: 1})}};
    });
    Object.defineProperty(window, "createEasyRpgPlayer", {configurable: true, value: create});
    const mounting = mountEasyRpg({sessionId: "run", engineMode: engine === "RPG2000" ? "rpg2k" : "rpg2k3",
      projectRootUrl: "https://game.test/index/", runtimeBaseUrl: "/core/", rtpSource: null}, target, window, payload,
      {signal: new AbortController().signal, reportExitRequested() {}});
    await vi.waitFor(() => expect(document.head.querySelector('script[data-rpg-runtime=easyrpg]')).not.toBeNull());
    document.head.querySelector('script[data-rpg-runtime=easyrpg]')!.dispatchEvent(new Event("load"));
    return {player: await mounting, fs, files, create};
  };
  const first = await setup(null);
  expect(first.player.getCheckpointAvailability()).toMatchObject({available: false, blocker: "NO_SAVE"});
  first.fs.writeFile("Save/Save01.lsd", Uint8Array.of(1, 2));
  first.fs.writeFile("Save/Save02.lsd", Uint8Array.of(3, 4));
  first.fs.writeFile("Save/RPG_RT.ini", Uint8Array.of(9));
  const captured = await first.player.checkpoint();
  expect((await decodeRpgCheckpoint(captured.bytes, engine)).entries).toHaveLength(3);
  await first.player.acknowledgeCheckpoint!(captured);
  expect(first.player.getCheckpointAvailability()).toMatchObject({available: false, blocker: "UNCHANGED"});
  await first.player.exit();
  const second = await setup(captured.bytes);
  expect(second.create.mock.calls[0][0]).not.toHaveProperty("runtimeRestoreSlot");
  expect(second.files.get("Save/Save01.lsd")).toEqual(Uint8Array.of(1, 2));
  expect(second.files.get("Save/Save02.lsd")).toEqual(Uint8Array.of(3, 4));
  expect(second.files.get("Save/RPG_RT.ini")).toEqual(Uint8Array.of(9));
  expect(second.files.has("Save/Save03.lsd")).toBe(false);
  expect(second.player.getCheckpointAvailability()).toMatchObject({available: false, blocker: "UNCHANGED"});
  second.fs.writeFile("Save/Save02.lsd", Uint8Array.of(5));
  expect(second.player.getCheckpointAvailability()).toMatchObject({available: true});
  await second.player.exit();
});
