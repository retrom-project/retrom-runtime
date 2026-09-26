import {describe, expect, it} from "vitest";
import {createNativeGameEditor} from "./editor.js";

describe("native-web game editor", () => {
  it("accepts the expanded RPG Maker category list through the public adapter", async () => {
    const ids = ["gold", "items", "weapons", "armors", "variables", "switches",
      "actors", "skills", "states", "classes", "party"];
    const editor = createNativeGameEditor({request: async () => ({type: "EDITOR_CATEGORIES_RESULT",
      body: {categories: ids.map((id) => ({id, label: id}))}})} as unknown as Parameters<typeof createNativeGameEditor>[0]);
    expect((await editor.categories()).map((category) => category.id)).toEqual(ids);
  });
});
