import {expect, it, vi} from "vitest";
import {startInputDiagnostics} from "../../provider/input-diagnostics.js";
import {observeEmulatorInput} from "./input-diagnostics.js";

it("calls the real input once with identical receiver/arguments and restores it", () => {
  const simulateInput = vi.fn(function (this: unknown, _player: number, _control: number, _value: number) {return this;});
  const manager = {simulateInput};
  const session = observeEmulatorInput(window, {gameManager: manager}, startInputDiagnostics(window, () => null));
  expect(manager.simulateInput(0, 8, 1)).toBe(manager);
  manager.simulateInput(0, 8, 0);
  expect(simulateInput.mock.calls).toEqual([[0, 8, 1], [0, 8, 0]]);
  expect(session.read().events.map((event) => [event.stage, event.value])).toEqual([["DELIVERED", 1], ["DELIVERED", 0]]);
  session.stop(); expect(manager.simulateInput).toBe(simulateInput);
});

it("preserves input exceptions and does not claim failed calls were delivered", () => {
  const error = new Error("core-input-failed");
  const manager = {simulateInput: vi.fn(() => {throw error;})};
  const session = observeEmulatorInput(window, {gameManager: manager}, startInputDiagnostics(window, () => null));
  expect(() => manager.simulateInput()).toThrow(error);
  expect(session.read().events).toEqual([]); session.stop();
});
