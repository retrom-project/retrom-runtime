import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type BridgeEvent = {
  data: unknown;
  origin: string;
  ports: FakePort[];
  stopImmediatePropagation: () => void;
};

type FakePort = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown) => void;
  start: () => void;
};

describe("native-web RPG Maker bridge", () => {
  it.each(["MV", "MZ"] as const)("edits standard %s values through the isolated protocol and rejects invalid writes", async (edition) => {
    const source = readFileSync(resolve(process.cwd(), "assets/runtime/native/bridge.js"), "utf8");
    const listeners = new Map<string, Array<(event: BridgeEvent) => void>>();
    const replies: Array<{type: string; requestId: number; body: Record<string, unknown>}> = [];
    const sceneManager = {_scene: null, updateMain: () => undefined};
    const learnedSkills = new Set<number>();
    const actorStates = new Set<number>();
    let actorClassId = 1;
    const actor = {
      hp: 10, mp: 4, tp: 2, level: 1, mhp: 20, mmp: 10,
      actorId: () => 1, name: () => "Hero", currentExp: () => 0,
      maxTp: () => 100, maxLevel: () => 99, param: (id: number) => id === 2 ? 5 : 10,
      paramMax: () => 999, addParam: vi.fn(), setHp: vi.fn(), setMp: vi.fn(),
      setTp: vi.fn(), changeLevel: vi.fn(), changeExp: vi.fn(),
      isLearnedSkill: (id: number) => learnedSkills.has(id),
      learnSkill: vi.fn((id: number) => learnedSkills.add(id)),
      forgetSkill: vi.fn((id: number) => learnedSkills.delete(id)),
      deathStateId: () => 1, isStateAffected: (id: number) => actorStates.has(id),
      addState: vi.fn((id: number) => actorStates.add(id)),
      removeState: vi.fn((id: number) => actorStates.delete(id)),
      currentClass: () => ({id: actorClassId}),
      changeClass: vi.fn((id: number) => {actorClassId = id;}),
    };
    const otherLearnedSkills = new Set<number>();
    const otherStates = new Set<number>();
    const otherActor = {
      ...actor,
      hp: 8, setHp: vi.fn(),
      actorId: () => 2, name: () => "Mage", isLearnedSkill: (id: number) => otherLearnedSkills.has(id),
      learnSkill: vi.fn((id: number) => otherLearnedSkills.add(id)),
      forgetSkill: vi.fn((id: number) => otherLearnedSkills.delete(id)),
      isStateAffected: (id: number) => otherStates.has(id),
      addState: vi.fn((id: number) => otherStates.add(id)),
      removeState: vi.fn((id: number) => otherStates.delete(id)),
    };
    const reserveActor = {...actor, actorId: () => 3, name: () => "Reserve"};
    const roster = [actor, otherActor, reserveActor];
    const partyIds = [1, 2];
    let gold = 10;
    let count = 1;
    let variable = 3;
    let enabled = false;
    let mapId = 0;
    const item = {id: 2, name: "Potion"};
    const runtime = {
      DataManager: {}, StorageManager: {}, Utils: {RPGMAKER_NAME: edition}, SceneManager: sceneManager,
      $dataItems: [null, {id: 1, name: ""}, item], $dataWeapons: [null], $dataArmors: [null],
      $dataSkills: [null, {id: 1, name: ""}, {id: 2, name: "Fire"}],
      $dataActors: [null, {id: 1, name: "Hero"}, {id: 2, name: "Mage"}, {id: 3, name: "Reserve"}],
      $dataStates: [null, {id: 1, name: "KO"}, {id: 2, name: "Poison"}, {id: 3, name: "Guard"}],
      $dataClasses: [null, {id: 1, name: "Warrior"}, {id: 2, name: "Mage"}],
      $dataSystem: {variables: ["", "", "Quest"], switches: ["", "", "Gate"]},
      $gameParty: {
        gold: () => gold, maxGold: () => 100, gainGold: (delta: number) => {gold += delta;},
        numItems: () => count, maxItems: () => 99, gainItem: (_item: unknown, delta: number) => {count += delta;},
        members: () => partyIds.map((id) => roster[id - 1]),
        allMembers: () => partyIds.map((id) => roster[id - 1]),
        addActor: vi.fn((id: number) => {if (!partyIds.includes(id)) partyIds.push(id);}),
        removeActor: vi.fn((id: number) => {const index = partyIds.indexOf(id); if (index >= 0) partyIds.splice(index, 1);}),
        swapOrder: vi.fn((left: number, right: number) => {
          [partyIds[left], partyIds[right]] = [partyIds[right], partyIds[left]];
        }),
      },
      $gameVariables: {value: () => variable, setValue: (_id: number, value: number) => {variable = value;}},
      $gameSwitches: {value: () => enabled, setValue: (_id: number, value: boolean) => {enabled = value;}},
      $gameMap: {mapId: () => mapId},
      addEventListener: (name: string, callback: (event: BridgeEvent) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), callback]);
      },
      parent: {postMessage: () => undefined}, requestAnimationFrame: () => 1,
    };
    runInNewContext(source, {TextDecoder, TextEncoder, window: runtime});
    const port: FakePort = {onmessage: null, postMessage: (message) => replies.push(message as typeof replies[number]),
      start: () => undefined};
    const identity = {launchId: "01980000-0000-7000-8000-000000000001", nonce: "test-nonce", protocolVersion: 1};
    listeners.get("message")?.[0]?.({
      data: {...identity, cleanupUrl: null, parentOrigin: "https://host.example",
        profile: `RPG${edition}`, type: "RPG_RUNTIME_NATIVE_CONNECT"},
      origin: "https://host.example", ports: [port], stopImmediatePropagation: () => undefined,
    });
    async function request(requestId: number, type: string, body: Record<string, unknown>) {
      port.onmessage?.({data: {...identity, requestId, type, body}});
      await vi.waitFor(() => expect(replies.some((reply) => reply.requestId === requestId)).toBe(true));
      return replies.find((reply) => reply.requestId === requestId)!;
    }
    expect((await request(1, "EDITOR_CATEGORIES", {})).body.categories).toEqual(expect.arrayContaining([
      {id: "gold", label: "金币"},
      {id: "actors", label: "角色", groups: [{id: "actors:1", label: "Hero"}, {id: "actors:2", label: "Mage"}]},
      {id: "skills", label: "技能", groups: [{id: "skills:1", label: "Hero"}, {id: "skills:2", label: "Mage"}]},
    ]));
    expect((await request(2, "EDITOR_ENTRIES", {category: "gold", query: "", offset: 0, limit: 20})).type)
      .toBe("ERROR");
    mapId = 1;
    expect((await request(3, "EDITOR_ENTRIES", {category: "items", query: "", offset: 0, limit: 20})).body)
      .toMatchObject({entries: [{id: "2", label: "Potion", value: 1}, {id: "1", value: 1}], nextOffset: null});
    expect((await request(4, "EDITOR_SET", {category: "gold", id: "gold", value: 50})).body)
      .toMatchObject({entry: {value: 50}});
    expect((await request(5, "EDITOR_SET", {category: "items", id: "2", value: 5})).body)
      .toMatchObject({entry: {value: 5}});
    expect((await request(6, "EDITOR_SET", {category: "variables", id: "1", value: 8})).body)
      .toMatchObject({entry: {value: 8}});
    expect((await request(7, "EDITOR_SET", {category: "switches", id: "1", value: true})).body)
      .toMatchObject({entry: {value: true}});
    await request(8, "EDITOR_SET", {category: "actors", id: "1:hp", value: 15});
    expect(actor.setHp).toHaveBeenCalledWith(15);
    expect((await request(9, "EDITOR_SET", {category: "gold", id: "gold", value: 101})).type).toBe("ERROR");
    expect(gold).toBe(50);
    expect((await request(10, "EDITOR_ENTRIES", {category: "variables", query: "", offset: 0, limit: 20})).body)
      .toMatchObject({entries: [{id: "2", label: "Quest"}, {id: "1", label: "变量 1"}]});
    expect((await request(11, "EDITOR_ENTRIES", {category: "switches", query: "", offset: 0, limit: 20})).body)
      .toMatchObject({entries: [{id: "2", label: "Gate"}, {id: "1", label: "开关 1"}]});
    expect((await request(12, "EDITOR_ENTRIES", {category: "skills:1", query: "Fire", offset: 0, limit: 20})).body)
      .toMatchObject({entries: [{id: "1:2", label: "Fire", value: false, valueType: "boolean"}], nextOffset: null});
    expect((await request(13, "EDITOR_SET", {category: "skills:1", id: "1:2", value: true})).body)
      .toMatchObject({entry: {id: "1:2", label: "Fire", value: true}});
    expect(actor.learnSkill).toHaveBeenCalledWith(2);
    expect((await request(14, "EDITOR_SET", {category: "skills:1", id: "1:2", value: false})).body)
      .toMatchObject({entry: {id: "1:2", value: false}});
    expect(actor.forgetSkill).toHaveBeenCalledWith(2);
    expect((await request(15, "EDITOR_SET", {category: "skills:1", id: "1:999", value: true})).type).toBe("ERROR");
    expect((await request(16, "EDITOR_SET", {category: "skills:2", id: "1:2", value: true})).type).toBe("ERROR");
    expect((await request(17, "EDITOR_ENTRIES", {category: "skills:2", query: "", offset: 0, limit: 20})).body)
      .toMatchObject({entries: [{id: "2:2", label: "Fire", value: false}], nextOffset: null});
    expect((await request(18, "EDITOR_SET", {category: "skills:2", id: "2:2", value: true})).body)
      .toMatchObject({entry: {id: "2:2", label: "Fire", value: true}});
    expect(otherActor.learnSkill).toHaveBeenCalledWith(2);
    expect(actor.learnSkill).toHaveBeenCalledTimes(1);
    expect((await request(19, "EDITOR_ENTRIES", {category: "actors:2", query: "2:hp", offset: 0, limit: 20})).body)
      .toMatchObject({entries: [{id: "2:hp", label: "生命", value: 8}], nextOffset: null});
    expect((await request(20, "EDITOR_SET", {category: "actors:2", id: "1:hp", value: 12})).type).toBe("ERROR");
    expect((await request(21, "EDITOR_SET", {category: "actors:2", id: "2:hp", value: 12})).body)
      .toMatchObject({entry: {id: "2:hp", label: "生命"}});
    expect(otherActor.setHp).toHaveBeenCalledWith(12);
    expect(actor.setHp).toHaveBeenCalledTimes(1);
    expect((await request(22, "EDITOR_CATEGORIES", {})).body.categories).toEqual(expect.arrayContaining([
      {id: "states", label: "状态", groups: [{id: "states:1", label: "Hero"}, {id: "states:2", label: "Mage"}]},
      {id: "classes", label: "职业", groups: [{id: "classes:1", label: "Hero"}, {id: "classes:2", label: "Mage"}]},
      {id: "party", label: "队伍成员"},
    ]));
    expect((await request(23, "EDITOR_ENTRIES", {category: "states:1", query: "", offset: 0, limit: 20})).body)
      .toMatchObject({entries: [{id: "1:2", label: "Poison", value: false}, {id: "1:3", label: "Guard", value: false}]});
    expect((await request(24, "EDITOR_SET", {category: "states:1", id: "1:2", value: true})).body)
      .toMatchObject({entry: {id: "1:2", value: true}});
    expect(actor.addState).toHaveBeenCalledWith(2);
    expect((await request(25, "EDITOR_SET", {category: "states:2", id: "1:2", value: true})).type).toBe("ERROR");
    expect((await request(26, "EDITOR_SET", {category: "states:1", id: "1:2", value: false})).body)
      .toMatchObject({entry: {id: "1:2", value: false}});
    expect((await request(27, "EDITOR_ENTRIES", {category: "classes:1", query: "", offset: 0, limit: 20})).body)
      .toMatchObject({entries: [{id: "1:1", label: "Warrior", value: true}, {id: "1:2", label: "Mage", value: false}]});
    expect((await request(28, "EDITOR_SET", {category: "classes:1", id: "1:1", value: false})).type).toBe("ERROR");
    expect((await request(29, "EDITOR_SET", {category: "classes:1", id: "1:2", value: true})).body)
      .toMatchObject({entry: {id: "1:2", value: true}});
    expect(actor.changeClass).toHaveBeenCalledWith(2, true);
    expect((await request(30, "EDITOR_ENTRIES", {category: "party", query: "", offset: 0, limit: 20})).body)
      .toMatchObject({entries: [{id: "1", value: 1}, {id: "2", value: 2}, {id: "3", value: 0}]});
    expect((await request(31, "EDITOR_SET", {category: "party", id: "3", value: 3})).body)
      .toMatchObject({entry: {id: "3", value: 3}});
    expect((await request(32, "EDITOR_SET", {category: "party", id: "3", value: 2})).body)
      .toMatchObject({entry: {id: "3", value: 2}});
    expect(partyIds).toEqual([1, 3, 2]);
    expect((await request(33, "EDITOR_SET", {category: "party", id: "3", value: 0})).body)
      .toMatchObject({entry: {id: "3", value: 0}});
    expect(partyIds).toEqual([1, 2]);
    expect((await request(34, "EDITOR_SET", {category: "party", id: "3", value: 1})).type).toBe("ERROR");
    expect((await request(35, "EDITOR_SET", {category: "party", id: "2", value: 0})).body)
      .toMatchObject({entry: {id: "2", value: 0}});
    expect((await request(36, "EDITOR_SET", {category: "party", id: "1", value: 0})).type).toBe("ERROR");
    actor.addState.mockImplementationOnce(() => actorStates);
    expect((await request(37, "EDITOR_SET", {category: "states:1", id: "1:2", value: true})).type).toBe("ERROR");
  });

  it("reports readiness without fixture-variable proofs and applies video modes inside the isolated frame", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "assets/runtime/native/bridge.js"),
      "utf8",
    );
    const listeners = new Map<string, Array<(event: BridgeEvent) => void>>();
    const replies: unknown[] = [];
    const nativeExit = vi.fn();
    const setImageRendering = vi.fn();
    const sceneManager = { _scene: null, exit: nativeExit, updateMain: () => undefined };
    const runtime = {
      DataManager: {},
      document: {querySelectorAll: () => [{style: {setProperty: setImageRendering}}]},
      SceneManager: sceneManager,
      StorageManager: {},
      Utils: { RPGMAKER_NAME: "MV" },
      addEventListener: (name: string, callback: (event: BridgeEvent) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), callback]);
      },
      parent: { postMessage: () => undefined },
      requestAnimationFrame: () => 1,
    };
    runInNewContext(source, { TextDecoder, TextEncoder, window: runtime });
    const port: FakePort = {
      onmessage: null,
      postMessage: (message) => replies.push(message),
      start: () => undefined,
    };

    listeners.get("message")?.[0]?.({
      data: {
        cleanupUrl: null,
        launchId: "01980000-0000-7000-8000-000000000001",
        nonce: "test-nonce",
        parentOrigin: "https://host.example",
        profile: "RPGMV",
        protocolVersion: 1,
        type: "RPG_RUNTIME_NATIVE_CONNECT",
      },
      origin: "https://host.example",
      ports: [port],
      stopImmediatePropagation: () => undefined,
    });
    sceneManager.updateMain();

    expect(replies).toContainEqual({
      body: {
        engine: "RPGMV",
        engineProfile: "RPGMV",
      },
      launchId: "01980000-0000-7000-8000-000000000001",
      nonce: "test-nonce",
      protocolVersion: 1,
      requestId: 0,
      type: "READY",
    });

    port.onmessage?.({data: {
      body: {mode: "pixel"},
      launchId: "01980000-0000-7000-8000-000000000001",
      nonce: "test-nonce",
      protocolVersion: 1,
      requestId: 1,
      type: "SET_VIDEO_MODE",
    }});
    await vi.waitFor(() => expect(replies).toContainEqual(expect.objectContaining({
      requestId: 1, type: "SET_VIDEO_MODE_RESULT",
    })));
    expect(setImageRendering).toHaveBeenCalledWith("image-rendering", "pixelated", "important");

    sceneManager.exit();
    sceneManager.exit();
    expect(nativeExit).toHaveBeenCalledTimes(2);
    expect(replies.filter((reply) => (reply as {type?: string}).type === "EXIT_REQUESTED")).toEqual([{
      body: {},
      launchId: "01980000-0000-7000-8000-000000000001",
      nonce: "test-nonce",
      protocolVersion: 1,
      requestId: 0,
      type: "EXIT_REQUESTED",
    }]);
  });

  it("preserves CanvasTextAlign semantics and does not wait for keepalive cleanup", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "assets/runtime/native/bridge.js"),
      "utf8",
    );
    const listeners = new Map<string, Array<(event: BridgeEvent) => void>>();
    const replies: unknown[] = [];
    const alignments = new WeakMap<object, string>();
    const nativeTextAlignSetter = vi.fn(function setTextAlign(this: object, value: string) {
      alignments.set(this, value);
    });
    class FakeCanvasRenderingContext2D {}
    Object.defineProperty(FakeCanvasRenderingContext2D.prototype, "textAlign", {
      configurable: true,
      get(this: object) {return alignments.get(this) ?? "start";},
      set: nativeTextAlignSetter,
    });
    let resolveCleanup!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolvePromise) => {resolveCleanup = resolvePromise;}));
    const runtime = {
      CanvasRenderingContext2D: FakeCanvasRenderingContext2D,
      addEventListener: (name: string, callback: (event: BridgeEvent) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), callback]);
      },
      fetch: fetcher,
      location: {href: "https://runtime.example/game/index.html", origin: "https://runtime.example"},
      parent: {postMessage: () => undefined},
      requestAnimationFrame: () => 1,
    };
    runInNewContext(source, {TextDecoder, TextEncoder, URL, window: runtime});
    const port: FakePort = {
      onmessage: null,
      postMessage: (message) => replies.push(message),
      start: () => undefined,
    };
    const launchId = "01980000-0000-7000-8000-000000000001";
    const nonce = "test-nonce";
    listeners.get("message")?.[0]?.({
      data: {
        cleanupUrl: "https://runtime.example/__retrom/cleanup",
        launchId, nonce, parentOrigin: "https://host.example", profile: "RPGMV",
        protocolVersion: 1, type: "RPG_RUNTIME_NATIVE_CONNECT",
      },
      origin: "https://host.example",
      ports: [port],
      stopImmediatePropagation: () => undefined,
    });

    const context = new FakeCanvasRenderingContext2D() as FakeCanvasRenderingContext2D & {textAlign: string};
    context.textAlign = "center";
    context.textAlign = undefined as unknown as string;
    expect(context.textAlign).toBe("center");
    expect(nativeTextAlignSetter).toHaveBeenCalledTimes(1);
    expect(nativeTextAlignSetter).toHaveBeenCalledWith("center");

    port.onmessage?.({data: {
      body: {}, launchId, nonce, protocolVersion: 1, requestId: 1, type: "CLEANUP",
    }});
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "https://runtime.example/__retrom/cleanup",
      {method: "POST", credentials: "same-origin", keepalive: true},
    ));
    await vi.waitFor(() => expect(replies).toContainEqual(expect.objectContaining({
      requestId: 1, type: "CLEANUP_RESULT",
    })));
    resolveCleanup(new Response(null, {status: 204}));
  });

  it("waits for the engine database before restoring an MV save", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "assets/runtime/native/bridge.js"),
      "utf8",
    );
    const listeners = new Map<string, Array<(event: BridgeEvent) => void>>();
    const replies: unknown[] = [];
    const animationFrames: Array<() => void> = [];
    let databaseLoaded = false;
    let loadedSave = "";
    const afterLoad = vi.fn();
    class SceneMap {}
    const storage = {
      exists: (slot: number) => slot < 0,
      load: (slot: number) => String(slot).slice(0, 0),
    };
    const sceneManager = {
      _scene: null as SceneMap | null,
      goto: () => {sceneManager._scene = new SceneMap();},
      updateMain: () => undefined,
    };
    const dataManager = {
      _globalInfo: [] as Array<unknown> | null,
      isDatabaseLoaded: () => databaseLoaded,
      loadGlobalInfo() {
        if (this._globalInfo) {return this._globalInfo;}
        const value = storage.load(0);
        return this._globalInfo = value ? JSON.parse(value) as Array<unknown> : [];
      },
      loadGame(slot: number) {
        if (!this.loadGlobalInfo()[slot]) {return false;}
        loadedSave = storage.load(slot);
        return true;
      },
    };
    const runtime = {
      $gameMap: { isEventRunning: () => false, mapId: () => 1 },
      $gameMessage: { isBusy: () => false },
      $gamePlayer: { x: 11, y: 8 },
      $gameSystem: { onAfterLoad: afterLoad },
      $gameVariables: { value: () => 1 },
      DataManager: dataManager,
      Scene_Map: SceneMap,
      SceneManager: sceneManager,
      StorageManager: storage,
      Utils: { RPGMAKER_NAME: "MV" },
      addEventListener: (name: string, callback: (event: BridgeEvent) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), callback]);
      },
      parent: { postMessage: () => undefined },
      requestAnimationFrame: (callback: () => void) => {animationFrames.push(callback); return animationFrames.length;},
    };
    const context = createContext({performance, TextDecoder, TextEncoder, window: runtime});
    runInContext(source, context);
    const saveData = runInContext(
      "Uint8Array.from([115,97,118,101,100,45,97,116,45,98]).buffer",
      context,
    ) as ArrayBuffer;
    const globalInfoJSON = JSON.stringify([...Array(21).fill(null), {title: "fixture"}]);
    const globalInfoValues = [...new TextEncoder().encode(globalInfoJSON)].join(",");
    const globalInfo = runInContext(`Uint8Array.from([${globalInfoValues}]).buffer`, context) as ArrayBuffer;
    const port: FakePort = {
      onmessage: null,
      postMessage: (message) => replies.push(message),
      start: () => undefined,
    };
    const launchId = "01980000-0000-7000-8000-000000000001";
    const nonce = "test-nonce";
    listeners.get("message")?.[0]?.({
      data: { cleanupUrl: null, launchId, nonce, parentOrigin: "https://host.example", profile: "RPGMV", protocolVersion: 1, type: "RPG_RUNTIME_NATIVE_CONNECT" },
      origin: "https://host.example",
      ports: [port],
      stopImmediatePropagation: () => undefined,
    });

    port.onmessage?.({data: {
      body: {bundle: {
        engine: "RPGMV",
        entries: [
          {data: globalInfo, key: "0", mediaType: "application/octet-stream", store: "LOCAL_STORAGE"},
          {data: saveData, key: "21", mediaType: "application/octet-stream", store: "LOCAL_STORAGE"},
        ],
        resumeSlot: 21,
      }},
      launchId,
      nonce,
      protocolVersion: 1,
      requestId: 1,
      type: "RESTORE",
    }});
    await Promise.resolve();
    expect(loadedSave).toBe("");
    expect(replies.some((reply) => (reply as {type?: string}).type === "RESTORE_RESULT")).toBe(false);

    databaseLoaded = true;
    animationFrames.shift()?.();
    await vi.waitFor(() => expect(replies).toContainEqual({
      body: {},
      launchId,
      nonce,
      protocolVersion: 1,
      requestId: 1,
      type: "RESTORE_RESULT",
    }));
    expect(loadedSave).toBe("saved-at-b");
    expect(afterLoad).toHaveBeenCalledOnce();
  });

  it("round-trips MZ saves through JsonEx so restored game objects keep their semantics", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "assets/runtime/native/bridge.js"),
      "utf8",
    );
    const listeners = new Map<string, Array<(event: BridgeEvent) => void>>();
    const replies: unknown[] = [];
    const animationFrames: Array<() => void> = [];
    let restoredMarker = "";
    let mapSceneStarted = true;
    const beforeSave = vi.fn();
    const afterLoad = vi.fn();
    class SceneMap {
      isStarted() {return mapSceneStarted;}
    }
    const storage: {
      exists: (key: string) => boolean;
      loadObject: (key: string) => Promise<unknown>;
      saveObject: (key: string, value: unknown) => Promise<void>;
    } = {
      exists: () => false,
      loadObject: async () => null,
      saveObject: async () => undefined,
    };
    const sceneManager = {
      _scene: new SceneMap(),
      goto: () => {sceneManager._scene = new SceneMap();},
      updateMain: () => undefined,
    };
    const dataManager = {
      isDatabaseLoaded: () => true,
      maxSavefiles: () => 20,
      async saveGame(slot: number) {
        await storage.saveObject(`file${slot}`, {
          marker: beforeSave.mock.calls.length ? "save-point-b" : "missing-before-save",
        });
        await storage.saveObject("global", [{ slot }]);
        return true;
      },
      async loadGame(slot: number) {
        const value = await storage.loadObject(`file${slot}`) as { restoredMarker?: () => string } | null;
        restoredMarker = value?.restoredMarker?.() ?? "missing-prototype";
        return true;
      },
    };
    const jsonEx = {
      stringify: (value: unknown) => JSON.stringify({ encodedByJsonEx: true, value }),
      parse: (json: string) => {
        const decoded = JSON.parse(json) as { encodedByJsonEx?: boolean; value?: unknown };
        if (decoded.encodedByJsonEx !== true) {throw new Error("missing JsonEx envelope");}
        return { ...(decoded.value as object), restoredMarker: () => "save-point-b" };
      },
    };
    const runtime = {
      $gameMap: { isEventRunning: () => false, mapId: () => 3 },
      $gameMessage: { isBusy: () => false },
      $gamePlayer: { x: 9, y: 13 },
      $gameSystem: { onAfterLoad: afterLoad, onBeforeSave: beforeSave },
      $gameVariables: { value: () => 0 },
      DataManager: dataManager,
      ColorManager: {_windowskin: null as {getPixel: () => string} | null},
      Graphics: {width: 0, height: 0},
      JsonEx: jsonEx,
      Scene_Map: SceneMap,
      SceneManager: sceneManager,
      StorageManager: storage,
      Utils: { RPGMAKER_NAME: "MZ" },
      addEventListener: (name: string, callback: (event: BridgeEvent) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), callback]);
      },
      parent: { postMessage: () => undefined },
      requestAnimationFrame: (callback: () => void) => {animationFrames.push(callback); return animationFrames.length;},
    };
    const context = createContext({ JSON, performance, TextDecoder, TextEncoder, window: runtime });
    runInContext(source, context);
    const port: FakePort = {
      onmessage: null,
      postMessage: (message) => replies.push(message),
      start: () => undefined,
    };
    const launchId = "01980000-0000-7000-8000-000000000001";
    const nonce = "test-nonce";
    listeners.get("message")?.[0]?.({
      data: { cleanupUrl: null, launchId, nonce, parentOrigin: "https://host.example", profile: "RPGMZ", protocolVersion: 1, type: "RPG_RUNTIME_NATIVE_CONNECT" },
      origin: "https://host.example",
      ports: [port],
      stopImmediatePropagation: () => undefined,
    });

    port.onmessage?.({data: { body: {}, launchId, nonce, protocolVersion: 1, requestId: 1, type: "SAVE" }});
    await vi.waitFor(() => expect(replies.some((reply) => (reply as {type?: string}).type === "SAVE_RESULT")).toBe(true));
    const saveReply = replies.find((reply) => (reply as {type?: string}).type === "SAVE_RESULT") as {
      body: {bundle: {
        engine: string;
        entries: Array<{data: ArrayBuffer; key: string; mediaType: string; store: string}>;
        resumeSlot: number;
      }};
    };
    const fileEntry = saveReply.body.bundle.entries.find((entry) => entry.key === "file21");
    expect(fileEntry && new TextDecoder().decode(fileEntry.data)).toContain('"encodedByJsonEx":true');
    expect(fileEntry && new TextDecoder().decode(fileEntry.data)).toContain('"marker":"save-point-b"');
    expect(beforeSave).toHaveBeenCalledOnce();
    const restoredBundle = {
      ...saveReply.body.bundle,
      entries: saveReply.body.bundle.entries.map((entry) => {
        const values = [...new Uint8Array(entry.data)].join(",");
        return {...entry, data: runInContext(`Uint8Array.from([${values}]).buffer`, context) as ArrayBuffer};
      }),
    };
    port.onmessage?.({data: {
      body: {bundle: restoredBundle},
      launchId,
      nonce,
      protocolVersion: 1,
      requestId: 2,
      type: "RESTORE",
    }});

    await Promise.resolve();
    expect(restoredMarker).toBe("");
    runtime.ColorManager._windowskin = {getPixel: () => "#ffffff"};
    mapSceneStarted = false;
    animationFrames.shift()?.();
    await Promise.resolve();
    expect(restoredMarker).toBe("");
    runtime.Graphics.width = 816;
    runtime.Graphics.height = 624;
    animationFrames.shift()?.();
    await vi.waitFor(() => expect(restoredMarker).toBe("save-point-b"));
    expect(replies).not.toContainEqual(expect.objectContaining({type: "RESTORE_RESULT"}));
    mapSceneStarted = true;
    animationFrames.shift()?.();
    await vi.waitFor(() => expect(replies.length).toBeGreaterThan(1));
    expect(replies).toContainEqual(expect.objectContaining({type: "RESTORE_RESULT"}));
    expect(restoredMarker).toBe("save-point-b");
    expect(afterLoad).toHaveBeenCalledOnce();
  });

});
