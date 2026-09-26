import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
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

describe("native-web RPG Maker game editor bridge", () => {
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
    const selfSwitches = new Map<string, boolean>();
    const pageWithSwitch = (key: string, text?: string) => ({conditions: {selfSwitchValid: true, selfSwitchCh: key},
      image: {tileId: 0, characterName: ""}, list: text ? [{code: 401, parameters: [text]}] : [{code: 0}]});
    const currentMap = {events: [null, {id: 1, name: "Chest", x: 4, y: 5, pages: [pageWithSwitch("A")]},
      {id: 2, name: "Unused", x: 7, y: 8, pages: []},
      {id: 3, name: "Torch", x: 9, y: 3, pages: [pageWithSwitch("B", "The torch is lit.")]}]};
    const otherMap = {events: [null, {id: 1, name: "Gate", x: 1, y: 2, pages: [pageWithSwitch("D")]}]};
    const fetchMap = vi.fn(async (path: string) => ({ok: path === "data/Map002.json",
      json: async () => otherMap}));
    const item = {id: 2, name: "Potion"};
    const runtime = {
      DataManager: {}, StorageManager: {}, Utils: {RPGMAKER_NAME: edition}, SceneManager: sceneManager,
      $dataItems: [null, {id: 1, name: ""}, item], $dataWeapons: [null], $dataArmors: [null],
      $dataSkills: [null, {id: 1, name: ""}, {id: 2, name: "Fire"}],
      $dataActors: [null, {id: 1, name: "Hero"}, {id: 2, name: "Mage"}, {id: 3, name: "Reserve"}],
      $dataStates: [null, {id: 1, name: "KO"}, {id: 2, name: "Poison"}, {id: 3, name: "Guard"}],
      $dataClasses: [null, {id: 1, name: "Warrior"}, {id: 2, name: "Mage"}],
      $dataSystem: {variables: ["", "", "Quest"], switches: ["", "", "Gate"]},
      $dataMapInfos: [null, {id: 1, name: "Start"}, {id: 2, name: "Forest"}],
      $dataMap: currentMap,
      $gameSelfSwitches: {value: (key: [number, number, string]) => selfSwitches.get(key.join(",")) || false,
        setValue: (key: [number, number, string], value: boolean) => selfSwitches.set(key.join(","), value)},
      fetch: fetchMap,
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
    expect((await request(38, "EDITOR_SELF_SWITCH_MAPS", {query: "", offset: 0, limit: 1})).body)
      .toMatchObject({currentMapId: 1, currentMapName: "Start", maps: [{id: 1, label: "Start"}], nextOffset: 1});
    expect((await request(39, "EDITOR_SELF_SWITCH_MAPS", {query: "forest", offset: 0, limit: 40})).body)
      .toMatchObject({maps: [{id: 2, label: "Forest"}], nextOffset: null});
    expect((await request(40, "EDITOR_SELF_SWITCH_EVENTS", {mapId: 1, query: "", offset: 0, limit: 1})).body)
      .toMatchObject({events: [{id: 1, label: "Chest", x: 4, y: 5,
        switches: {A: false, B: false, C: false, D: false},
        pageUses: [{key: "A", page: 1, summary: "无图像、无事件指令"}]}], nextOffset: 1});
    expect((await request(41, "EDITOR_SELF_SWITCH_SET", {mapId: 1, eventId: 1, key: "A", value: true})).body)
      .toMatchObject({event: {id: 1, switches: {A: true, B: false, C: false, D: false}}});
    expect(selfSwitches.get("1,1,A")).toBe(true);
    expect((await request(42, "EDITOR_SELF_SWITCH_EVENTS", {mapId: 2, query: "gate", offset: 0, limit: 40})).body)
      .toMatchObject({events: [{id: 1, label: "Gate", switches: {A: false},
        pageUses: [{key: "D", page: 1}]}], nextOffset: null});
    expect(fetchMap).toHaveBeenCalledWith("data/Map002.json", {credentials: "same-origin"});
    expect((await request(43, "EDITOR_SELF_SWITCH_SET", {mapId: 2, eventId: 1, key: "D", value: true})).body)
      .toMatchObject({event: {id: 1, switches: {D: true}}});
    expect((await request(44, "EDITOR_SELF_SWITCH_SET", {mapId: 2, eventId: 999, key: "A", value: true})).type)
      .toBe("ERROR");
    expect((await request(45, "EDITOR_SELF_SWITCH_SET", {mapId: 1, eventId: 1, key: "E", value: true})).type)
      .toBe("ERROR");
    expect((await request(46, "EDITOR_SELF_SWITCH_EVENTS", {mapId: 3, query: "", offset: 0, limit: 40})).type)
      .toBe("ERROR");
    expect((await request(47, "EDITOR_SELF_SWITCH_EVENTS", {mapId: 1, query: "unused", offset: 0, limit: 40})).body)
      .toMatchObject({events: [], nextOffset: null});
    expect((await request(48, "EDITOR_SELF_SWITCH_EVENTS", {mapId: 1, query: "torch", offset: 0, limit: 40})).body)
      .toMatchObject({events: [{id: 3, pageUses: [{key: "B", page: 1, summary: "首句：The torch is lit."}]}]});
    expect((await request(49, "EDITOR_SELF_SWITCH_SET", {mapId: 1, eventId: 1, key: "B", value: true})).type)
      .toBe("ERROR");
  });

});
