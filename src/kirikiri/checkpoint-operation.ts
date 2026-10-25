import {digestKirikiriCheckpoint, encodeKirikiriCheckpoint, kirikiriGameSaveFormat} from "./checkpoint.js";
import type {KirikiriWriteOverlay} from "./write-overlay.js";

export type KirikiriCheckpointModule = {
  pauseMainLoop(): void | Promise<void>;
  resumeMainLoop(): void;
  krkr2StopMainLoop(operation?: Promise<unknown>): Promise<void>;
  _krkr2_host_flush_game_saves(): Promise<number>;
};

export function createKirikiriCheckpointOperation(options: {module: KirikiriCheckpointModule; overlay: KirikiriWriteOverlay}) {
  return new KirikiriCheckpointOperation(options);
}

class KirikiriCheckpointOperation {
  private paused = false;
  private closing = false;
  private finalizing = false;
  private active: Promise<{bytes: Uint8Array; format: string} | null> | undefined;
  private final: Promise<{bytes: Uint8Array; format: string} | null> | undefined;
  private stopping: Promise<void> | undefined;
  private readonly cancellation = new AbortController();
  private readonly captures = new Map<string, number>();

  constructor(private readonly options: {module: KirikiriCheckpointModule; overlay: KirikiriWriteOverlay}) {}

  checkpoint() {
    this.requireOpen();
    if (this.active || this.finalizing) {throw invalidState();}
    const operation = Promise.resolve().then(() => this.capture(false));
    this.active = operation;
    const clear = () => {if (this.active === operation) {this.active = undefined;}};
    void operation.then(clear, clear);
    return operation;
  }

  finalCheckpoint() {
    this.requireOpen();
    if (this.final) {return this.final;}
    // onExit can arrive from the original Wasm tick. Mark the terminal intent
    // now, but defer all module calls until its JavaScript callback returns.
    this.finalizing = true;
    const previous = this.active;
    const operation = Promise.resolve().then(async () => {
      if (previous) {await previous;}
      return this.capture(true);
    });
    this.final = operation;
    this.active = operation;
    const clear = () => {if (this.active === operation) {this.active = undefined;}};
    void operation.then(clear, clear);
    return operation;
  }

  async acknowledge(bytes: Uint8Array) {
    this.requireOpen();
    const key = await digestKirikiriCheckpoint(bytes);
    const revision = this.captures.get(key);
    if (revision !== undefined) {
      this.options.overlay.acknowledged = Math.max(this.options.overlay.acknowledged, revision);
      this.captures.delete(key);
    }
  }

  async pause() {
    this.requireOpen();
    if (this.finalizing) {await this.final?.catch(() => undefined); return;}
    this.paused = true;
    if (this.active) {await this.active.catch(() => undefined);}
    else {await this.options.module.pauseMainLoop();}
  }

  async resume() {
    this.requireOpen();
    if (this.finalizing) {return;}
    this.paused = false;
    if (!this.active) {this.options.module.resumeMainLoop();}
  }

  stop() {
    if (!this.stopping) {
      this.closing = true; this.cancellation.abort();
      // Stop new ticks synchronously; retain the active native stack and save
      // observer until content cancellation and this capture have drained.
      this.stopping = this.options.module.krkr2StopMainLoop(this.active);
    }
    return this.stopping;
  }

  private capture(final: false): Promise<{bytes: Uint8Array; format: string}>;
  private capture(final: true): Promise<{bytes: Uint8Array; format: string} | null>;
  private async capture(final: boolean): Promise<{bytes: Uint8Array; format: string} | null> {
    const {module, overlay} = this.options;
    this.requireOpen();
    try {
      try {await module.pauseMainLoop();}
      catch (error) {
        // Emscripten 6.0.9 calls onExit(0), then rejects its enclosing JSPI tick
        // with this control-flow object. An ordinary capture already handed to
        // finalCheckpoint sees the same unwind. No other drain error is clean.
        if ((!final && !this.finalizing) || !normalExitStatus(error)) {throw error;}
      }
      this.requireOpen(); overlay.requireValid();
      if (this.nothingToCapture(final)) {return null;}
      // A pending ordinary capture can be handed to finalCheckpoint by onExit
      // while its original frame drains. That engine must not run scripts again.
      if (!final && !this.finalizing) {
        const flushed = await module._krkr2_host_flush_game_saves();
        if (flushed !== 0 && flushed !== 1) {throw new Error(`KIRIKIRI_GAME_SAVE_FLUSH_FAILED: ${flushed}`);}
        this.requireOpen(); overlay.requireValid();
      }
      await this.waitForQuiet();
      this.requireOpen(); overlay.requireValid();
      if (this.nothingToCapture(final)) {return null;}
      const revision = overlay.sequence;
      const bytes = await encodeKirikiriCheckpoint({progressPaths: [...overlay.progressPaths],
        entries: [...overlay.writes].map(([path, data]) => ({path, data: data?.slice() ?? null}))});
      const key = await digestKirikiriCheckpoint(bytes);
      this.requireOpen();
      this.captures.set(key, revision);
      if (this.captures.size > 32) {this.captures.delete(this.captures.keys().next().value!);}
      return {bytes, format: kirikiriGameSaveFormat};
    } catch (cause) {
      if (this.closing) {throw invalidState();}
      throw new Error(final ? "KIRIKIRI_CHECKPOINT_FINAL_FAILED" : "KIRIKIRI_CHECKPOINT_CREATE_FAILED", {cause});
    } finally {
      if (!this.closing && !this.finalizing) {
        if (this.paused) {await module.pauseMainLoop();}
        else {module.resumeMainLoop();}
      }
    }
  }

  private nothingToCapture(final: boolean) {
    const availability = this.options.overlay.availability();
    if (availability === null) {return false;}
    if (final && (availability === "NO_SAVE" || availability === "UNCHANGED")) {return true;}
    throw new Error(availability === "NOT_READY" ? "KIRIKIRI_NATIVE_SAVE_INCOMPLETE" : "KIRIKIRI_NO_SAVE");
  }

  private async waitForQuiet() {
    const deadline = Date.now() + 10_000;
    while (Date.now() - this.options.overlay.lastWriteAt < 250) {
      this.requireOpen();
      if (Date.now() >= deadline) {throw new Error("KiriKiri native writes did not become quiet");}
      await new Promise<void>((resolve, reject) => {
        const signal = this.cancellation.signal;
        const abort = () => {clearTimeout(timer); reject(invalidState());};
        const timer = setTimeout(() => {signal.removeEventListener("abort", abort); resolve();}, 25);
        signal.addEventListener("abort", abort, {once: true});
        if (signal.aborted) {abort();}
      });
    }
  }

  private requireOpen() {if (this.closing) {throw invalidState();}}
}

function invalidState() {return new Error("KIRIKIRI_RUNTIME_INVALID_STATE");}

function normalExitStatus(error: unknown) {
  return error !== null && typeof error === "object" && "name" in error && error.name === "ExitStatus" &&
    "status" in error && error.status === 0;
}
