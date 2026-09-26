import {describe, expect, it} from "vitest";
import {createNativeGameEditor} from "./editor.js";

describe("native-web game editor", () => {
  it("accepts the expanded RPG Maker category list through the public adapter", async () => {
    const ids = ["gold", "items", "weapons", "armors", "variables", "switches",
      "actors", "skills", "states", "classes", "party", "self_switches"];
    const editor = createNativeGameEditor({request: async () => ({type: "EDITOR_CATEGORIES_RESULT",
      body: {categories: ids.map((id) => ({id, label: id}))}})} as unknown as Parameters<typeof createNativeGameEditor>[0]);
    expect((await editor.categories()).map((category) => category.id)).toEqual(ids);
  });
  it("validates paged maps, events and writes for event self switches", async () => {
    const event = {id: 2, label: "宝箱", x: 4, y: 5,
      switches: {A: true, B: false, C: false, D: false}};
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
