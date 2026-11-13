import {describe, expect, it} from "vitest";
import {createNativeGameEditor} from "./editor.js";

describe("native-web game editor", () => {
  it("transfers collection scopes, null slots and fractional values through the public editor", async () => {
    const values = [
      {id: "1", label: "Stats", value: "数组 · 2 项", valueType: "collection", children: "variables:1"},
      {id: "1:1", label: "[0]", value: null, valueType: "null"},
      {id: "1:2", label: "[1]", value: 2.5, valueType: "number", min: -100, max: 100, step: "any"},
    ];
    const requests: unknown[] = [];
    const editor = createNativeGameEditor({request: async (type: string, body: Record<string, unknown>) => {
      requests.push({type, body});
      return type === "EDITOR_ENTRIES"
        ? {type: "EDITOR_ENTRIES_RESULT", body: {entries: values, nextOffset: null}}
        : {type: "EDITOR_SET_RESULT", body: {entry: {...values[2], value: body.value}}};
    }} as unknown as Parameters<typeof createNativeGameEditor>[0]);
    await expect(editor.entries("variables:1", "", 0, 40)).resolves.toMatchObject({entries: values});
    await expect(editor.set("variables:1", "1:2", 3.75)).resolves.toMatchObject({value: 3.75});
    expect(requests).toContainEqual({type: "EDITOR_SET", body: {category: "variables:1", id: "1:2", value: 3.75}});
    await expect(editor.set("variables:1", "1:2", Infinity)).rejects.toThrow("RPG_GAME_EDITOR_INVALID");
  });

  it.each([
    {id: "1", label: "Stats", value: "Array", valueType: "collection", children: "bad/category"},
    {id: "1", label: "Stats", value: "Array", valueType: "collection"},
    {id: "1", label: "Score", value: 2.5, valueType: "number"},
    {id: "1", label: "Score", value: 2.5, valueType: "number", step: "any", min: 10, max: 1},
  ])("rejects malformed structured metadata %#", async entry => {
    const editor = createNativeGameEditor({request: async () => ({type: "EDITOR_ENTRIES_RESULT",
      body: {entries: [entry], nextOffset: null}})} as unknown as Parameters<typeof createNativeGameEditor>[0]);
    await expect(editor.entries("variables", "", 0, 40)).rejects.toThrow("RPG_GAME_EDITOR_INVALID");
  });
  it("accepts the expanded RPG Maker category list through the public adapter", async () => {
    const ids = ["gold", "items", "weapons", "armors", "variables", "switches",
      "actors", "skills", "states", "classes", "party", "self_switches"];
    const editor = createNativeGameEditor({request: async () => ({type: "EDITOR_CATEGORIES_RESULT",
      body: {categories: ids.map((id) => ({id, label: id}))}})} as unknown as Parameters<typeof createNativeGameEditor>[0]);
    expect((await editor.categories()).map((category) => category.id)).toEqual(ids);
  });
  it("validates paged maps, events and writes for event self switches", async () => {
    const event = {id: 2, label: "宝箱", x: 4, y: 5,
      switches: {A: true, B: false, C: false, D: false},
      pageUses: [{key: "A", page: 2, summary: "无图像、无事件指令"}]};
    const editor = createNativeGameEditor({request: async (type: string) => type === "EDITOR_SELF_SWITCH_MAPS"
      ? {type: "EDITOR_SELF_SWITCH_MAPS_RESULT", body: {currentMapId: 1, currentMapName: "村庄",
        maps: [{id: 1, label: "村庄"}], nextOffset: null}}
      : type === "EDITOR_SELF_SWITCH_EVENTS"
        ? {type: "EDITOR_SELF_SWITCH_EVENTS_RESULT", body: {events: [event], nextOffset: null}}
        : {type: "EDITOR_SELF_SWITCH_SET_RESULT", body: {event}}} as unknown as Parameters<typeof createNativeGameEditor>[0]);
    await expect(editor.selfSwitches!.maps("", 0, 40)).resolves.toMatchObject({currentMapId: 1});
    await expect(editor.selfSwitches!.events(1, "宝箱", 0, 40)).resolves.toMatchObject({events: [event]});
    await expect(editor.selfSwitches!.set(1, 2, "A", true)).resolves.toEqual(event);
    await expect(editor.selfSwitches!.set(1, 2, "E" as "A", true)).rejects.toThrow("RPG_GAME_EDITOR_INVALID");
  });
});
