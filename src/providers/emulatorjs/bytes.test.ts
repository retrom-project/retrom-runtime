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
});
