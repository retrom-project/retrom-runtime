import {expect, it} from "vitest";
import {runtimeGamePolicy} from "../provider/content-policies.js";
it.each(["rpgmaker-2000", "rpgmaker-2003"])("%s retains lazy loading through managed persistent content", id => {
  expect(runtimeGamePolicy(id)).toMatchObject({mode: "ON_OPEN", result: "BYTES"});
});
