import {describe, expect, it, vi} from "vitest";

import {readEmulatorJsCheckpoint} from "./bytes.js";

describe("EmulatorJS checkpoint bytes", () => {
  it("retries after one running frame when a paused core cannot serialize immediately", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const ForeignUint8Array = (frame.contentWindow as Window & typeof globalThis).Uint8Array;
    const getState = vi.fn()
      .mockImplementationOnce(() => {throw new Error("core is paused");})
      .mockReturnValue(new ForeignUint8Array([1, 2, 3]));
    const toggleMainLoop = vi.fn();
    const waitForRunningFrame = vi.fn(async () => undefined);

    await expect(readEmulatorJsCheckpoint(
      {getState, toggleMainLoop}, true, waitForRunningFrame,
    )).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(toggleMainLoop.mock.calls).toEqual([[true], [false]]);
    expect(waitForRunningFrame).toHaveBeenCalledOnce();
  });
  it("keeps the retry running until an asynchronous native save completes", async () => {
    let complete!: (value: Uint8Array) => void;
    const pending = new Promise<Uint8Array>((resolve) => {complete = resolve;});
    const getState = vi.fn().mockRejectedValueOnce(new Error("paused")).mockReturnValueOnce(pending);
    const toggleMainLoop = vi.fn();
    const result = readEmulatorJsCheckpoint({getState, toggleMainLoop}, true, async () => undefined);
    await vi.waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    expect(toggleMainLoop.mock.calls).toEqual([[true]]);
    complete(Uint8Array.of(4, 5, 6));
    await expect(result).resolves.toEqual(Uint8Array.of(4, 5, 6));
    expect(toggleMainLoop.mock.calls).toEqual([[true], [false]]);
  });

});
