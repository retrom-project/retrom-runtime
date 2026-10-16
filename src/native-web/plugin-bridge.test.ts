import {readFileSync} from "node:fs";
import {createContext, runInContext} from "node:vm";
import {expect, it, vi} from "vitest";

// Project-owned engine/plugin fixture: shared files, map titles, and the MV load call order.
function fixture() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const replies: Array<{type: string; body: Record<string, unknown>}> = [];
  const port = {onmessage: null as null | ((event: {data: unknown}) => void), start() {},
    postMessage(message: {type: string; body: Record<string, unknown>}) {replies.push(message);}};
  const context = createContext({TextEncoder, TextDecoder, URL, performance, setTimeout,
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, [...listeners.get(name) ?? [], callback]),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    parent: {postMessage() {}}, document: {}, location: {href: "https://game.test/run/id/A%20Game/www/index.html"},
  });
  runInContext(`window = globalThis;
    var local = new Map();
    var StorageManager = {localFileDirectoryPath: () => {throw Error('desktop path');},
      save: (id, json) => local.set(id, json), load: id => local.get(id), exists: id => local.has(id)};
    var Utils = {RPGMAKER_NAME: 'MV'};
    var $dataSystem = {gameTitle: 'Game'};
    var $gameMap = {mapId: () => 1, isEventRunning: () => false};
    var $gameMessage = {isBusy: () => false};
    var $gameSystem = {onBeforeSave() {}, onAfterLoad() {}};
    var shared, position = 7;
    var Scene_Map = class {isStarted() {return true;}};
    var Scene_Title = class {start() {} isStarted() {return true;}};
    var Scene_Boot = class {start() {DataManager.createGameObjects();}};
    var SceneManager = {_scene: null, updateMain() {}, isSceneChanging: () => false, isCurrentSceneBusy: () => false,
      goto(Type = Scene_Map) {this._scene = new Type(); if(this._scene instanceof Scene_Title) this._scene.start();}};
    var DataManager = {_globalId: 'RPGMV', _globalInfo: null, isDatabaseLoaded: () => true, maxSavefiles: () => 20,
      createGameObjects() {
        const fs = require('fs'), path = StorageManager.localFileDirectoryPath() + 'common.rpgsave';
        shared = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, {encoding: 'utf8'})) : {};
      },
      makeSavefileInfo() {return {globalId: this._globalId, title: 'Map display name'};},
      loadGlobalInfo() {return this._globalInfo ??= JSON.parse(StorageManager.load(0) || '[]');},
      isThisGameFile(id) {
        const info = this.loadGlobalInfo()[id];
        return !!info && info.globalId === this._globalId && info.title === $dataSystem.gameTitle;
      },
      saveGame(id) {
        StorageManager.save(id, JSON.stringify({position}));
        const info = this.loadGlobalInfo(); info[id] = this.makeSavefileInfo();
        StorageManager.save(0, JSON.stringify(info)); return true;
      },
      loadGame(id) {
        if (!this.isThisGameFile(id)) return false;
        this.createGameObjects(); position = JSON.parse(StorageManager.load(id)).position; return true;
      }
    };
  `, context);
  runInContext(readFileSync("assets/runtime/native/bridge.js", "utf8"), context);
  const identity = {launchId: "fixture", nonce: "nonce", protocolVersion: 1};
  listeners.get("message")?.forEach(listener => listener({source: context.parent, origin: "https://host.test", ports: [port],
    stopImmediatePropagation() {}, data: {...identity, parentOrigin: "https://host.test", profile: "RPGMV",
      type: "RPG_RUNTIME_NATIVE_CONNECT", pluginFiles: runInContext(`[{path:'scenario/En/start.sl', data: new Uint8Array(new TextEncoder().encode('story')).buffer}]`, context)}}));
  let id = 0;
  return {context, replies,
    hide() {listeners.get("pagehide")?.forEach(listener => listener({}));},
    boot() {listeners.get("load")?.forEach(listener => listener({target: context.document})); runInContext("new Scene_Boot().start(); SceneManager.goto();", context);},
    async request(type: string, body: Record<string, unknown> = {}) {
      const before = replies.length;
      context.requestJSON = JSON.stringify(body, (_key, value) =>
        Object.prototype.toString.call(value) === "[object ArrayBuffer]" ? [...new Uint8Array(value)] : value);
      const transferred = runInContext("JSON.parse(requestJSON, (key, value) => key === 'data' ? new Uint8Array(value).buffer : value)", context);
      port.onmessage?.({data: {...identity, requestId: ++id, type, body: transferred}});
      await vi.waitFor(() => expect(replies.length).toBeGreaterThan(before));
      return replies.at(-1)!;
    },
  };
}

it("boots desktop save plugins, reads scenarios and restores shared files before game objects in a fresh instance", async () => {
  const first = fixture(); first.boot();
  expect(runInContext("shared", first.context)).toEqual({});
  expect(runInContext("require('fs').readFileSync('/run/id/A Game/scenario/En/start.sl', 'utf8')", first.context)).toBe("story");
  runInContext(`shared = {flag: true, count: 23}; require('fs').writeFileSync(StorageManager.localFileDirectoryPath()+'common.rpgsave', JSON.stringify(shared));`, first.context);
  const saved = await first.request("SAVE");
  expect(saved.type).toBe("SAVE_RESULT");
  const bundle = saved.body.bundle as {entries: Array<{data: ArrayBuffer; store: string; key: string}>};
  expect(bundle.entries).toContainEqual(expect.objectContaining({store: "FILESYSTEM", key: "save/common.rpgsave"}));
  const second = fixture(); second.boot();
  expect(runInContext("shared", second.context)).toEqual({});
  // Recreate transferred ArrayBuffers in the second realm, like a real MessagePort.
  second.context.snapshotJSON = JSON.stringify({...bundle, entries: bundle.entries.map(entry => ({...entry, data: [...new Uint8Array(entry.data)]}))});
  const restored = runInContext("JSON.parse(snapshotJSON, (key, value) => key === 'data' ? new Uint8Array(value).buffer : value)", second.context);
  expect((await second.request("RESTORE", {bundle: restored})).type).toBe("RESTORE_RESULT");
  expect(runInContext("shared", second.context)).toEqual({flag: true, count: 23});
  expect(runInContext("position", second.context)).toBe(7);
  await first.request("CLEANUP"); await second.request("CLEANUP");
});
it("keeps map display titles while validating game identity for native slots", () => {
  const game = fixture(); game.boot();
  runInContext("DataManager.saveGame(1);", game.context);
  expect(runInContext("DataManager.loadGlobalInfo()[1].title", game.context)).toBe("Map display name");
  expect(runInContext("DataManager.isThisGameFile(1)", game.context)).toBe(true);
  runInContext("DataManager._globalInfo[1].runtimeGameTitle = 'Other game';", game.context);
  expect(runInContext("DataManager.isThisGameFile(1)", game.context)).toBe(false);
  runInContext("DataManager._globalInfo[1].runtimeGameTitle = 'Game'; DataManager._globalInfo[1].globalId = 'foreign';", game.context);
  expect(runInContext("DataManager.isThisGameFile(1)", game.context)).toBe(false);
});
it("rejects out-of-scope shared files and restores the previous files if the engine rejects a save", async () => {
  const game = fixture(); game.boot();
  runInContext("require('fs').writeFileSync('save/common.rpgsave', 'old')", game.context);
  const saved = await game.request("SAVE");
  const bundle = saved.body.bundle as {entries: Array<{key: string; store: string; data: ArrayBuffer}>};
  const common = bundle.entries.find(entry => entry.store === "FILESYSTEM")!;
  common.key = "scenario/overwrite.sl";
  expect((await game.request("RESTORE", {bundle})).body.code).toBe("RPG_CHECKPOINT_RESTORE_INVALID");
  common.key = "save/common.rpgsave";
  common.data = runInContext("new Uint8Array([110,101,119]).buffer", game.context);
  runInContext("DataManager.loadGame = () => false", game.context);
  expect((await game.request("RESTORE", {bundle})).body.code).toBe("RPG_CHECKPOINT_RESTORE_FAILED");
  expect(runInContext("require('fs').readFileSync('save/common.rpgsave','utf8')", game.context)).toBe("old");
  await game.request("CLEANUP");
});
it("times out or cancels a restore while plugin boot is incomplete without entering the map", async () => {
  for (const cancel of [false, true]) {
    const game = fixture(); game.boot();
    const saved = await game.request("SAVE");
    const second = fixture();
    let now = 0; second.context.performance = {now: () => now};
    second.context.snapshotJSON = JSON.stringify(saved.body.bundle, (_key, value) =>
      Object.prototype.toString.call(value) === "[object ArrayBuffer]" ? [...new Uint8Array(value)] : value);
    const bundle = runInContext("JSON.parse(snapshotJSON, (key, value) => key === 'data' ? new Uint8Array(value).buffer : value)", second.context);
    const restoring = second.request("RESTORE", {bundle});
    await new Promise(resolve => setTimeout(resolve, 0));
    if (cancel) {second.hide();}
    else {now = 30001;}
    expect((await restoring).body.code).toBe(cancel ? "RPG_NATIVE_CHANNEL_CLOSED" : "RPG_CHECKPOINT_RESTORE_TIMEOUT");
    expect(runInContext("SceneManager._scene", second.context)).toBe(null);
    await game.request("CLEANUP");
  }
});
