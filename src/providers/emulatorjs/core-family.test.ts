import {expect, it} from "vitest";
import {registerCoreFamily} from "./core-family.js";

it("adds an owned arcade core to the loader's ZIP-preserving family without modifying other cores", () => {
  const families = {arcade: ["fbneo"], nes: ["fceumm"]};
  const original = () => families;
  const instance = {getCores: original};
  const cleanup = registerCoreFamily(instance, "fbalpha", "arcade");
  expect(instance.getCores()).toEqual({arcade: ["fbneo", "fbalpha"], nes: ["fceumm"]});
  expect(instance.getCores().arcade.filter(core => core === "fbalpha")).toHaveLength(1);
  expect(families.arcade).toEqual(["fbneo"]);
  cleanup();
  expect(instance.getCores).toBe(original);
});

it("fails explicitly when the pinned loader's family contract changes", () => {
  expect(() => registerCoreFamily({}, "fbalpha", "arcade")).toThrow("PLAYER_RUNTIME_UNAVAILABLE");
  expect(() => registerCoreFamily({getCores: () => ({})}, "fbalpha", "arcade"))
    .toThrow("PLAYER_RUNTIME_UNAVAILABLE");
});
