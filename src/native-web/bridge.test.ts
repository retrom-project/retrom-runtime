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
    const actor = {
      hp: 10, mp: 4, tp: 2, level: 1, mhp: 20, mmp: 10,
      actorId: () => 1, name: () => "Hero", currentExp: () => 0,
      maxTp: () => 100, maxLevel: () => 99, param: (id: number) => id === 2 ? 5 : 10,
      paramMax: () => 999, addParam: vi.fn(), setHp: vi.fn(), setMp: vi.fn(),
      setTp: vi.fn(), changeLevel: vi.fn(), changeExp: vi.fn(),
      isLearnedSkill: (id: number) => learnedSkills.has(id),
      learnSkill: vi.fn((id: number) => learnedSkills.add(id)),
      forgetSkill: vi.fn((id: number) => learnedSkills.delete(id)),
    };
    const otherLearnedSkills = new Set<number>();
    const otherActor = {
      ...actor,
      actorId: () => 2, name: () => "Mage", isLearnedSkill: (id: number) => otherLearnedSkills.has(id),
      learnSkill: vi.fn((id: number) => otherLearnedSkills.add(id)),
      forgetSkill: vi.fn((id: number) => otherLearnedSkills.delete(id)),
    };
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
      $dataSystem: {variables: ["", "", "Quest"], switches: ["", "", "Gate"]},
      $gameParty: {
        gold: () => gold, maxGold: () => 100, gainGold: (delta: number) => {gold += delta;},
        numItems: () => count, maxItems: () => 99, gainItem: (_item: unknown, delta: number) => {count += delta;},
        members: () => [actor, otherActor],
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
      {id: "gold", label: "金币"}, {id: "actors", label: "角色"},
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

describe("native-web RPG Maker screenshot bridge", () => {
  it("renders a native screenshot from the current scene instead of the discarded WebGL canvas", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "assets/runtime/native/bridge.js"),
      "utf8",
    );
    const listeners = new Map<string, Array<(event: BridgeEvent) => void>>();
    const replies: unknown[] = [];
    const renderedPng = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1);
    const destroy = vi.fn();
    let snapAttempt = 0;
    const snap = vi.fn(() => ({
      canvas: {
        toBlob: (callback: BlobCallback, mediaType: string) => {
          snapAttempt += 1;
          callback(snapAttempt <= 3 ? null : new Blob([renderedPng], {type: mediaType}));
        },
      },
      destroy,
    }));
    const animationFrames: FrameRequestCallback[] = [];
    const runtime = {
      Bitmap: {snap},
      SceneManager: {_scene: {marker: "visible-scene"}, updateMain: () => undefined},
      document: {
        querySelector: () => ({
          toBlob: (callback: BlobCallback) => callback(new Blob([Uint8Array.of(0)], {type: "image/png"})),
        }),
      },
      addEventListener: (name: string, callback: (event: BridgeEvent) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), callback]);
      },
      parent: {postMessage: () => undefined},
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      },
    };
    runInNewContext(source, {Blob, TextDecoder, TextEncoder, window: runtime});
    const port: FakePort = {
      onmessage: null,
      postMessage: (message) => replies.push(message),
      start: () => undefined,
    };
    const launchId = "01980000-0000-7000-8000-000000000001";
    const nonce = "test-nonce";
    listeners.get("message")?.[0]?.({
      data: {cleanupUrl: null, launchId, nonce, parentOrigin: "https://host.example", profile: "RPGMV", protocolVersion: 1, type: "RPG_RUNTIME_NATIVE_CONNECT"},
      origin: "https://host.example",
      ports: [port],
      stopImmediatePropagation: () => undefined,
    });

    port.onmessage?.({data: {body: {}, launchId, nonce, protocolVersion: 1, requestId: 1, type: "SCREENSHOT"}});
    expect(snap).not.toHaveBeenCalled();
    animationFrames.shift()?.(0);
    await vi.waitFor(() => expect(animationFrames).toHaveLength(1));
    animationFrames.shift()?.(16);
    await vi.waitFor(() => expect(animationFrames).toHaveLength(1));
    animationFrames.shift()?.(32);
    await vi.waitFor(() => expect(animationFrames).toHaveLength(1));
    animationFrames.shift()?.(48);
    await vi.waitFor(() => expect(replies).toContainEqual(expect.objectContaining({type: "SCREENSHOT_RESULT"})));
    const reply = replies.find((value) => (value as {type?: string}).type === "SCREENSHOT_RESULT") as {
      body: {data: ArrayBuffer; mediaType: string};
    };
    expect([...new Uint8Array(reply.body.data)]).toEqual([...renderedPng]);
    expect(reply.body.mediaType).toBe("image/png");
    expect(snap).toHaveBeenCalledTimes(4);
    expect(snap).toHaveBeenCalledWith(runtime.SceneManager._scene);
    expect(destroy).toHaveBeenCalledTimes(4);
  });
});
