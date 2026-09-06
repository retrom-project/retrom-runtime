import {afterEach, describe, expect, it, vi} from "vitest";
import {installPspRestoreObserver} from "./psp-restore.js";
afterEach(() => {vi.useRealTimers(); Reflect.deleteProperty(window, "EJS_Runtime");});
describe("PSP native restore completion", () => {
  it("waits for the core receipt and forwards native logging", async () => {
    const target = window as Window & {EJS_Runtime?: (config: Record<string, unknown>) => unknown};
    const observer = installPspRestoreObserver(window);
    let config!: {print: (...args: unknown[]) => void; postMainLoop: () => void};
    const factory = vi.fn((value) => {config = value;}); target.EJS_Runtime = factory;
    const print = vi.fn(); target.EJS_Runtime!({print});
    const completion = observer.wait(); const finished = vi.fn(); void completion.promise.then(finished);
    config.print('[State] Loading state "other.state".'); await Promise.resolve(); expect(finished).not.toHaveBeenCalled();
    config.print('[State] Loading state "/game.state".'); config.postMainLoop(); await Promise.resolve(); expect(finished).not.toHaveBeenCalled();
    config.postMainLoop(); await completion.promise;
    expect(print).toHaveBeenCalledTimes(2); observer.cleanup();
    expect(target.EJS_Runtime).toBeUndefined();
  });
  it("rejects a failed native load and cancels pending timers on exit", async () => {
    vi.useFakeTimers();
    const target = window as Window & {EJS_Runtime?: (config: Record<string, unknown>) => unknown};
    const observer = installPspRestoreObserver(window);
    let config!: {printErr: (...args: unknown[]) => void};
    target.EJS_Runtime = value => {config = value as typeof config;}; target.EJS_Runtime!({});
    const failed = observer.wait(); const rejected = expect(failed.promise).rejects.toThrow("PLAYER_SAVE_STATE_RESTORE_FAILED");
    config.printErr('[State] Failed to load state "/game.state".'); await rejected;
    const pending = observer.wait(); const ended = expect(pending.promise).rejects.toThrow("PLAYER_SESSION_ENDED");
    observer.cleanup(); await ended; expect(vi.getTimerCount()).toBe(0);
  });
});
