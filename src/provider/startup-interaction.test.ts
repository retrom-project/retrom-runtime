import {expect, it, vi} from "vitest";
import {StartupInteraction} from "./startup-interaction.js";

it("waits for an explicit valid choice and discards stale or repeated replies", async () => {
  const emit = vi.fn();
  const session = new StartupInteraction(emit);
  const pending = session.request({id: "entries", title: "Choose", choices: [{id: "2", label: "Two"}, {id: "3", label: "Three"}]});
  expect(emit.mock.calls[0][0]).toMatchObject({type: "STARTUP_INTERACTION", interaction: {id: "entries"}});
  expect(() => session.respond("entries", "1")).toThrow("PLAYER_STARTUP_INTERACTION_INVALID");
  expect(() => session.respond("stale", "2")).toThrow("PLAYER_STARTUP_INTERACTION_INVALID");
  session.respond("entries", "3");
  expect(await pending).toBe("3");
  expect(emit.mock.calls.at(-1)?.[0]).toEqual({type: "STARTUP_INTERACTION", interaction: null});
  expect(() => session.respond("entries", "3")).toThrow();
});

it("cancels a pending choice and rejects duplicate ids and unbounded labels", async () => {
  const session = new StartupInteraction(vi.fn());
  expect(() => session.request({id: "x", title: "x", choices: [{id: "a", label: "x"}, {id: "a", label: "y"}]})).toThrow();
  expect(() => session.request({id: "x", title: "x", choices: [{id: "a", label: "x".repeat(1001)}]})).toThrow();
  const pending = session.request({id: "x", title: "x", choices: [{id: "a", label: "x"}]});
  const result = expect(pending).rejects.toMatchObject({name: "AbortError"});
  session.cancel();
  session.cancel();
  await result;
});
