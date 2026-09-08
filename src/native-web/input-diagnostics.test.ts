import {expect, it, vi} from "vitest";
import {NativeInputDiagnostics, validSnapshot} from "./input-diagnostics.js";

it("reuses status replies without extra polling and disables only its current session", async () => {
  const request = vi.fn(async () => undefined);
  const diagnostics = new NativeInputDiagnostics(request);
  const first = diagnostics.start();
  expect(request).toHaveBeenCalledExactlyOnceWith("INPUT_DIAGNOSTICS", {enabled: true});
  first.read(); first.read(); expect(request).toHaveBeenCalledTimes(1);
  const second = diagnostics.start();
  first.stop(); expect(request).toHaveBeenCalledTimes(3);
  second.stop(); second.stop(); await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(4);
  expect(request).toHaveBeenLastCalledWith("INPUT_DIAGNOSTICS", {enabled: false});
});

it("rejects oversized or invalid observations rather than trusting bridge contents", () => {
  const snapshot = {events: [], held: [], dropped: 0, focus: "GAME", keyboard: true, gamepad: true, delivery: true, coreRead: false};
  expect(validSnapshot(snapshot)).toBe(true);
  expect(validSnapshot({...snapshot, coreRead: true})).toBe(false);
  expect(validSnapshot({...snapshot, events: new Array(65).fill({})})).toBe(false);
  expect(validSnapshot({...snapshot, dropped: Infinity})).toBe(false);
});
