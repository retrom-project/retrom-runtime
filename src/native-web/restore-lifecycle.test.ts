import {readFileSync} from "node:fs";
import {createContext, runInContext} from "node:vm";
import {expect, it} from "vitest";

// Project-owned engine model: queued scene changes, async readiness and a title-before-load plugin.
// The plugin's opening flag deliberately lives outside the serialized game objects.
function fixture(engine: "MV" | "MZ", skipTitle = false) {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const frames: Array<() => void> = [];
  const replies: Array<{type: string; body: {code?: string}}> = [];
  const port = {onmessage: null as null | ((event: {data: unknown}) => void), start() {},
    postMessage(message: (typeof replies)[number]) {replies.push(message);}};
  let now = 0;
  const context = createContext({TextEncoder, TextDecoder, URL, engine, skipTitle,
    performance: {now: () => now}, document: {}, location: {href: "https://game.test/run/id/index.html"},
    parent: {postMessage() {}}, requestAnimationFrame: (callback: () => void) => frames.push(callback),
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      listeners.set(name, [...listeners.get(name) ?? [], callback]),
  });
  runInContext(`window = globalThis;
    var trace = [], titleReady = false, mapReady = true, bootReady = false, failLoad = false, titleFade = 0;
    var position = 0, waiting = false, titleStarts = 0, loads = 0, afterLoads = 0;
    var Utils = {RPGMAKER_NAME: engine}, JsonEx = JSON;
    var Graphics = {width: 816, height: 624}, ColorManager = {_windowskin: {getPixel() {}}};
    var Input = {pressed: false, update() {}, clear() {this.pressed = false;}};
    var TouchInput = {pressed: false, update() {}, clear() {this.pressed = false;}};
    var $dataSystem = {gameTitle: 'Lifecycle fixture'};
    var $gameMap = {mapId: () => 1, isEventRunning: () => waiting};
    var $gameMessage = {isBusy: () => false};
    var $gameSystem = {onAfterLoad() {afterLoads++; trace.push('afterLoad');}};
    var StorageManager = {exists: () => false, load: () => null, loadObject: async () => null};
    var DataManager = {isDatabaseLoaded: () => true,
      async loadGame(slot) {
        loads++; trace.push('load');
        if (failLoad) throw Error('fixture-load-failed');
        const value = engine === 'MZ' ? await StorageManager.loadObject('file'+slot) : JSON.parse(StorageManager.load(slot));
        position = value.position; return true;
      }
    };
    var Scene_Base = class {
      create() {this.created = true;}
      isReady() {return true;}
      start() {this.started = true;}
      isStarted() {return this.started === true;}
      isBusy() {return false;}
      stop() {} terminate() {} update() {}
    };
    var Scene_Map = class extends Scene_Base {isReady() {return mapReady;}};
    var Scene_Title = class extends Scene_Base {
      isReady() {return titleReady;}
      isBusy() {return this.fade > 0;}
      start() {super.start(); this.fade = titleFade; titleStarts++; trace.push('title'); if(skipTitle) SceneManager.goto(Scene_Map);}
      update() {
        // Loading game globals can change the plugin's transition mode midway through a title fade.
        if(loads === 0 && this.fade > 0) this.fade--;
        if(Input.pressed || TouchInput.pressed) {position = -999; SceneManager.goto(Scene_Map);}
      }
    };
    var Scene_Boot = class extends Scene_Base {
      isReady() {return bootReady;}
      start() {super.start(); trace.push('boot'); SceneManager.goto(Scene_Map);}
    };
    var SceneManager = {
      _scene: null, _nextScene: null, _sceneStarted: false,
      goto(Type) {this._nextScene = new Type(); this._scene?.stop();},
      isSceneChanging() {return !!this._nextScene;},
      isCurrentSceneStarted() {return !!this._scene && this._sceneStarted;},
      isCurrentSceneBusy() {return !!this._scene && this._scene.isBusy();},
      updateMain() {
        Input.update(); TouchInput.update();
        if(this._nextScene && !this.isCurrentSceneBusy()) {
          this._scene?.terminate(); this._scene = this._nextScene; this._nextScene = null; this._scene.create();
          this._sceneStarted = false;
        }
        if(this._sceneStarted) this._scene.update();
        else if(this._scene.isReady()) {this._scene.start(); this._sceneStarted = true;}
      }
    };
    if(engine === 'MV') delete Scene_Base.prototype.isStarted;
    else delete SceneManager.isCurrentSceneStarted;
    (() => {
      let opening = true;
      const start = Scene_Title.prototype.start;
      Scene_Title.prototype.start = function() {start.call(this); opening = false;};
      Scene_Map.prototype.update = function() {
        if(waiting && Input.pressed && opening) SceneManager.goto(Scene_Title);
        else if(waiting && Input.pressed) {waiting = false; trace.push('story');}
      };
    })();
    SceneManager.goto(Scene_Boot);
  `, context);
  runInContext(readFileSync("assets/runtime/native/bridge.js", "utf8"), context);
  listeners.get("load")?.forEach(listener => listener({target: context.document}));
  const identity = {launchId: "fixture", nonce: "nonce", protocolVersion: 1};
  listeners.get("message")?.forEach(listener => listener({source: context.parent, origin: "https://host.test", ports: [port],
    stopImmediatePropagation() {}, data: {...identity, parentOrigin: "https://host.test", profile: "RPG" + engine,
      type: "RPG_RUNTIME_NATIVE_CONNECT", pluginFiles: []}}));
  let id = 0;
  return {
    read: (expression: string): unknown => runInContext(expression, context), replies,
    async tick(count = 1) {
      for (let index = 0; index < count; index++) {
        runInContext("SceneManager.updateMain()", context);
        frames.splice(0).forEach(callback => callback());
        for (let microtask = 0; microtask < 12; microtask++) await Promise.resolve();
      }
    },
    restore() {
      const bundle = runInContext(`({engine:'RPG'+engine, resumeSlot:21, entries:[{
        store:engine==='MZ'?'LOCALFORAGE':'LOCAL_STORAGE', key:engine==='MZ'?'file21':'21',
        mediaType:'application/octet-stream', data:new Uint8Array(new TextEncoder().encode('{"position":42}')).buffer
      }]})`, context);
      port.onmessage?.({data: {...identity, requestId: ++id, type: "RESTORE", body: {bundle}}});
    },
    close() {listeners.get("pagehide")?.forEach(listener => listener({}));},
    expire() {now = 31000;},
  };
}

it.each(["MV", "MZ"] as const)("%s restores after title plugin hooks and can continue a waiting story", async engine => {
  const game = fixture(engine);
  game.restore(); await game.tick(4);
  expect(game.read("loads")).toBe(0);
  game.read("bootReady = true"); await game.tick(4);
  expect(game.read("loads")).toBe(0);
  game.read("titleReady = true"); await game.tick(8);
  expect(game.replies).toContainEqual(expect.objectContaining({type: "RESTORE_RESULT"}));
  expect(game.read("trace")).toEqual(["boot", "title", "load", "afterLoad"]);
  expect(game.read("position")).toBe(42);
  game.read("waiting = true; Input.pressed = true"); await game.tick(2);
  expect(game.read("SceneManager._scene instanceof Scene_Map")).toBe(true);
  expect(game.read("trace.includes('story')")).toBe(true);
  expect(game.read("titleStarts")).toBe(1);
  game.close();
});

it("honors a title plugin that immediately starts its custom map", async () => {
  const game = fixture("MZ", true);
  game.read("bootReady = titleReady = true; mapReady = false"); game.restore(); await game.tick(8);
  expect(game.read("loads")).toBe(0);
  game.read("mapReady = true"); await game.tick(8);
  expect(game.replies).toContainEqual(expect.objectContaining({type: "RESTORE_RESULT"}));
  expect(game.read("trace")).toEqual(["boot", "title", "load", "afterLoad"]);
  expect(game.read("position")).toBe(42);
  game.close();
});

it.each(["MV", "MZ"] as const)("%s finishes title fades before replacing game objects from a save", async engine => {
  const game = fixture(engine);
  game.read("bootReady = titleReady = true; titleFade = 20"); game.restore(); await game.tick(8);
  expect(game.read("titleStarts")).toBe(1);
  expect(game.read("loads")).toBe(0);
  await game.tick(30);
  expect(game.replies).toContainEqual(expect.objectContaining({type: "RESTORE_RESULT"}));
  expect(game.read("position")).toBe(42);
  expect(game.read("SceneManager._scene instanceof Scene_Map")).toBe(true);
  game.close();
});

it("blocks input during restore and releases it only after the restored map starts", async () => {
  const game = fixture("MZ");
  game.read("bootReady = titleReady = true; mapReady = false"); game.restore();
  for (let index = 0; index < 12; index++) {
    game.read("Input.pressed = TouchInput.pressed = true"); await game.tick();
  }
  expect(game.replies.some(reply => reply.type === "RESTORE_RESULT")).toBe(false);
  expect(game.read("position")).toBe(42);
  game.read("mapReady = true"); await game.tick(4);
  expect(game.replies).toContainEqual(expect.objectContaining({type: "RESTORE_RESULT"}));
  expect(game.read("Input.pressed || TouchInput.pressed")).toBe(false);
  game.read("waiting = true; Input.pressed = true"); await game.tick(2);
  expect(game.read("trace.includes('story')")).toBe(true);
  game.close();
});

it.each(["timeout", "close"])("does not load after a title wait ends with %s", async reason => {
  const game = fixture("MZ"); game.read("bootReady = true"); game.restore(); await game.tick(4);
  if (reason === "close") game.close(); else game.expire();
  await game.tick(4);
  expect(game.replies).toContainEqual(expect.objectContaining({type: "ERROR", body: {
    code: reason === "close" ? "RPG_NATIVE_CHANNEL_CLOSED" : "RPG_CHECKPOINT_RESTORE_TIMEOUT",
  }}));
  expect(game.read("loads")).toBe(0);
  game.read("titleReady = true"); await game.tick(4);
  expect(game.read("loads")).toBe(0);
  game.close();
});

it("leaves normal new-game boot untouched", async () => {
  const game = fixture("MZ"); game.read("bootReady = true"); await game.tick(5);
  expect(game.read("trace")).toEqual(["boot"]);
  expect(game.read("SceneManager._scene instanceof Scene_Map")).toBe(true);
  expect(game.read("loads")).toBe(0);
  game.close();
});

it("releases the input guard when native loading fails", async () => {
  const game = fixture("MZ");
  game.read("bootReady = titleReady = failLoad = true"); game.restore(); await game.tick(10);
  expect(game.replies).toContainEqual(expect.objectContaining({type: "ERROR", body: {code: "fixture-load-failed"}}));
  game.read("Input.pressed = TouchInput.pressed = true; Input.update(); TouchInput.update()");
  expect(game.read("Input.pressed && TouchInput.pressed")).toBe(true);
  expect(game.read("afterLoads")).toBe(0);
  game.close();
});

it.each(["timeout", "close"])("does not enter the map when an async native load finishes after %s", async reason => {
  const game = fixture("MZ");
  game.read("bootReady = titleReady = true; var finishLoad; DataManager.loadGame = () => new Promise(resolve => {finishLoad = resolve;})");
  game.restore(); await game.tick(8);
  expect(game.read("typeof finishLoad")).toBe("function");
  if (reason === "close") game.close(); else game.expire();
  game.read("finishLoad(true)"); await game.tick(4);
  expect(game.replies).toContainEqual(expect.objectContaining({type: "ERROR", body: {
    code: reason === "close" ? "RPG_NATIVE_CHANNEL_CLOSED" : "RPG_CHECKPOINT_RESTORE_TIMEOUT",
  }}));
  expect(game.read("SceneManager._scene instanceof Scene_Title")).toBe(true);
  expect(game.read("afterLoads")).toBe(0);
  game.read("Input.pressed = true; Input.update()");
  expect(game.read("Input.pressed")).toBe(true);
  game.close();
});

it("does not restart a title lifecycle that already finished", async () => {
  const game = fixture("MZ"); game.read("bootReady = titleReady = true"); await game.tick(4);
  game.read("SceneManager.goto(Scene_Title)"); await game.tick(3);
  game.restore(); await game.tick(8);
  expect(game.replies).toContainEqual(expect.objectContaining({type: "RESTORE_RESULT"}));
  expect(game.read("titleStarts")).toBe(1);
  expect(game.read("afterLoads")).toBe(1);
  game.close();
});
