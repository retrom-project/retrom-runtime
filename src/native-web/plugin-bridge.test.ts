import {expect, it, vi} from "vitest";
import {decodeRpgCheckpoint} from "../checkpoint.js";
import {nativeGameFixture} from "../../tests/native-game-save-fixture.js";

it("restores every native slot and shared plugin file before a caching plugin boots in a fresh instance", async () => {
  const first = nativeGameFixture("MV"); await first.boot();
  expect(first.read("require('fs').existsSync('save/common.rpgsave')")).toBe(false);
  expect((await first.request("STATUS")).body.availability).toMatchObject({available: false, blocker: "NO_SAVE"});
  first.read(`DataManager.saveGame(1); DataManager.saveGame(2);
    require('fs').writeFileSync('save/common.rpgsave', '{"unlocked":true}');`);
  const exported = await first.request("SAVE");
  expect(exported.type).toBe("SAVE_RESULT");
  const bundle = await decodeRpgCheckpoint(new Uint8Array(exported.body.data as ArrayBuffer), "RPGMV");
  expect(bundle.entries.map(entry => entry.key).sort()).toEqual(["RPG File1", "RPG File2", "RPG Global", "save/common.rpgsave"]);
  const second = nativeGameFixture("MV", bundle); await second.boot();
  // The plugin caches its index during boot, exactly as in the reported failure.
  expect(second.read("DataManager._globalInfoCache[1]")).toEqual({title: "Native fixture"});
  expect(second.read("DataManager._globalInfoCache[2]")).toEqual({title: "Native fixture"});
  expect(second.read("trace")).toEqual(["boot"]);
  expect(second.read("SceneManager._scene.name")).toBe("title");
  expect(second.read("DataManager.loadGame(2)")).toEqual({position: 42});
  expect(second.read("require('fs').readFileSync('save/common.rpgsave','utf8')")).toBe('{"unlocked":true}');
  expect((await second.request("STATUS")).body.availability).toMatchObject({available: false, blocker: "UNCHANGED"});
  await first.request("CLEANUP"); await second.request("CLEANUP");
});

it("waits for asynchronous MZ storage import before starting the engine, retaining all native encodings", async () => {
  const bytes = new TextEncoder().encode('native compressed bytes \u0000\u00ff');
  const game = nativeGameFixture("MZ", {engine: "RPGMZ", entries: [
    {store: "LOCALFORAGE", key: "rmmzsave.1.global", mediaType: "application/octet-stream", data: bytes},
    {store: "LOCALFORAGE", key: "rmmzsave.1.file1", mediaType: "application/octet-stream", data: bytes},
    {store: "LOCALFORAGE", key: "rmmzsave.1.file2", mediaType: "application/octet-stream", data: bytes},
  ]});
  game.read("var finishImport; blockImport = new Promise(resolve => {finishImport = resolve;})");
  const booting = game.boot(); await new Promise(resolve => setTimeout(resolve, 10));
  expect(game.read("trace")).toEqual([]);
  game.read("finishImport()"); await booting;
  expect(game.read("forage.size")).toBe(3);
  expect(game.read("trace")).toEqual(["boot"]);
  game.read("forage.set('rmmzsave.1.file2','updated'); forage.set('rmmzsave.test','temporary')");
  const saved = await game.request("SAVE");
  const bundle = await decodeRpgCheckpoint(new Uint8Array(saved.body.data as ArrayBuffer), "RPGMZ");
  expect(bundle.entries.map(entry => entry.key)).not.toContain("rmmzsave.test");
  expect(new TextDecoder().decode(bundle.entries.find(entry => entry.key.endsWith('file1'))!.data)).toBe('native compressed bytes \u0000\u00ff');
  expect(game.read("trace")).not.toContain("load");
  await game.request("CLEANUP");
});

it("confirms only the acknowledged native export and includes unsynchronized data in a native exit", async () => {
  const game = nativeGameFixture("MV"); await game.boot();
  game.read("DataManager.saveGame(1)");
  const exported = await game.request("SAVE");
  const bundle = await decodeRpgCheckpoint(new Uint8Array(exported.body.data as ArrayBuffer), "RPGMV");
  game.read("DataManager.saveGame(2)");
  await game.request("ACKNOWLEDGE_SAVE", {bundle});
  expect((await game.request("STATUS")).body.availability).toMatchObject({available: true});
  game.read("SceneManager.exit(); SceneManager.exit()");
  await vi.waitFor(() => expect(game.replies.filter(reply => reply.type === "EXIT_REQUESTED")).toHaveLength(1));
  const exits = game.replies.filter(reply => reply.type === "EXIT_REQUESTED");
  expect(exits).toHaveLength(1);
  const final = await decodeRpgCheckpoint(new Uint8Array(exits[0].body.data as ArrayBuffer), "RPGMV");
  expect(final.entries.some(entry => entry.key === 'RPG File2')).toBe(true);
  await game.request("CLEANUP");
});

it("recognizes native progress through the engine's actual storage keys without changing plugin metadata", async () => {
  const game = nativeGameFixture("MV"); await game.boot();
  game.read(`StorageManager.webStorageKey = id => 'project-slot-' + id;
    localStorage.setItem(StorageManager.webStorageKey(1),'native progress');`);
  const status = await game.request("STATUS");
  expect(status.body.availability).toMatchObject({available: true, save: {dataKind: "PROGRESS"}});
  expect((await game.request("SAVE")).body.screenshot).toBeNull();
  await game.request("CLEANUP");
});

it.each(["MV", "MZ"] as const)("%s replaces the isolated native directory when restoring within the same run", async engine => {
  const store = engine === "MV" ? "LOCAL_STORAGE" : "LOCALFORAGE";
  const key = engine === "MV" ? "RPG File1" : "rmmzsave.1.file1";
  const game = nativeGameFixture(engine, {engine: engine === "MV" ? "RPGMV" : "RPGMZ", entries: [
    {store, key, mediaType: "application/octet-stream", data: new TextEncoder().encode("native slot 1")},
  ]}, {local: {"RPG File2": "later slot"}, forage: {"rmmzsave.1.file2": "later slot"}});
  await game.boot();
  expect(game.read("({local: [...local.keys()], forage: [...forage.keys()]})")).toMatchObject(engine === "MV"
    ? {local: [key]} : {local: [], forage: [key]});
  expect((await game.request("STATUS")).body.availability).toMatchObject({available: false, blocker: "UNCHANGED"});
  await game.request("CLEANUP");
});

it("retains the current run's native data on a reload without a restore descriptor", async () => {
  const game = nativeGameFixture("MV", null, {local: {"RPG File1": "native slot 1"}});
  await game.boot();
  expect(game.read("localStorage.getItem('RPG File1')")).toBe("native slot 1");
  expect((await game.request("STATUS")).body.availability).toMatchObject({available: true});
  await game.request("CLEANUP");
});
