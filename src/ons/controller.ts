import type { CheckpointAvailability, RuntimeState } from "../contract.js";
import type { MountedOnsAdapter } from "./internal-adapter.js";
import type { OnsCheckpointPayload, OnsRuntime, OnsRuntimeEvent } from "./contract.js";

type MountAdapter = (target: HTMLElement) => Promise<MountedOnsAdapter>;

const unavailable: CheckpointAvailability = { available: false, reason: "RUNTIME_NOT_READY" };

export class OnsRuntimeController implements OnsRuntime {
  private readonly mountAdapter: MountAdapter;
  private readonly signal: AbortSignal | null;
  private readonly listeners = new Set<(event: OnsRuntimeEvent) => void>();
  private adapter: MountedOnsAdapter | null = null;
  private state: RuntimeState = "CREATED";
  private mountCalled = false;
  private exitPromise: Promise<void> | null = null;

  constructor(mountAdapter: MountAdapter, signal: AbortSignal | null) {
    this.mountAdapter = mountAdapter;
    this.signal = signal;
    signal?.addEventListener("abort", this.abort, { once: true });
  }

  async mount(target: HTMLElement) {
    if (this.mountCalled || this.state !== "CREATED") {throw new Error("ONS_RUNTIME_INVALID_STATE");}
    this.mountCalled = true;
    if (this.signal?.aborted) {await this.exit(); throw new DOMException("Aborted", "AbortError");}
    this.transition("LOADING");
    try {
      const adapter = await this.mountAdapter(target);
      if (this.signal?.aborted || exitStarted(this.state)) {
        await adapter.exit();
        throw new DOMException("Aborted", "AbortError");
      }
      this.adapter = adapter;
      this.transition("RUNNING");
      this.emit({ type: "READY" });
    } catch (error) {
      await this.fail(error);
      throw stableError(error);
    }
  }

  async pause() {
    this.requireState("RUNNING");
    await this.perform("RUNNING", "PAUSED", () => this.requireAdapter().pause());
  }

  async resume() {
    this.requireState("PAUSED");
    await this.perform("PAUSED", "RUNNING", () => this.requireAdapter().resume());
  }

  async checkpoint(): Promise<OnsCheckpointPayload> {
    if (this.state !== "RUNNING" && this.state !== "PAUSED") {throw new Error("ONS_RUNTIME_INVALID_STATE");}
    const previous = this.state;
    this.transition("CHECKPOINTING");
    try {
      const bytes = await this.requireAdapter().checkpoint();
      if (!bytes.byteLength) {throw new Error("ONS_CHECKPOINT_CREATE_FAILED");}
      this.requireState("CHECKPOINTING");
      this.transition(previous);
      return { bytes: bytes.slice(), payloadKind: "ONS_SAVE_BUNDLE_V1" };
    } catch (error) {
      this.restoreCheckpointState(previous);
      throw stableError(error);
    }
  }

  async screenshot() {
    if (this.state !== "RUNNING" && this.state !== "PAUSED") {throw new Error("ONS_RUNTIME_INVALID_STATE");}
    const value = await this.requireAdapter().screenshot();
    if (!value.size) {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
    return value;
  }

  async exit() {
    if (this.exitPromise) {return this.exitPromise;}
    this.exitPromise = this.performExit();
    return this.exitPromise;
  }

  getState() {return this.state;}

  getCheckpointAvailability(): CheckpointAvailability {
    if (this.state === "FAILED") {return { available: false, reason: "RUNTIME_FAILED" };}
    return this.adapter && (this.state === "RUNNING" || this.state === "PAUSED")
      ? { available: true, reason: null }
      : unavailable;
  }

  subscribe(listener: (event: OnsRuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  }

  private readonly abort = () => {void this.exit();};

  private async perform(expected: RuntimeState, next: RuntimeState, operation: () => Promise<void>) {
    try {
      await operation();
      this.requireState(expected);
      this.transition(next);
    } catch (error) {
      if (!exitStarted(this.state)) {await this.fail(error);}
      throw stableError(error);
    }
  }

  private async performExit() {
    if (this.state === "EXITED") {return;}
    const failed = this.state === "FAILED";
    if (!failed) {this.transition("EXITING");}
    let exitError: unknown;
    try {await this.adapter?.exit();}
    catch (error) {exitError = error;}
    this.adapter = null;
    this.signal?.removeEventListener("abort", this.abort);
    if (!failed) {this.transition("EXITED");}
    this.listeners.clear();
    if (exitError) {throw stableError(exitError);}
  }

  private async fail(error: unknown) {
    const adapter = this.adapter;
    this.adapter = null;
    if (this.state !== "FAILED" && this.state !== "EXITED") {this.transition("FAILED");}
    try {await adapter?.exit();} catch { /* Preserve the runtime failure. */ }
    this.emit({ type: "FATAL_ERROR", code: stableError(error).message });
  }

  private requireAdapter() {
    if (!this.adapter) {throw new Error("ONS_RUNTIME_INVALID_STATE");}
    return this.adapter;
  }

  private requireState(expected: RuntimeState) {
    if (this.state !== expected) {throw new Error("ONS_RUNTIME_INVALID_STATE");}
  }

  private restoreCheckpointState(previous: "RUNNING" | "PAUSED") {
    if (this.state === "CHECKPOINTING") {this.transition(previous);}
  }

  private transition(next: RuntimeState) {
    if (!validTransition(this.state, next)) {throw new Error("ONS_RUNTIME_INVALID_STATE");}
    const previous = this.state;
    this.state = next;
    this.emit({ type: "STATE_CHANGED", previous, state: next });
  }

  private emit(event: OnsRuntimeEvent) {
    for (const listener of this.listeners) {listener(event);}
  }
}

const transitions: Record<RuntimeState, readonly RuntimeState[]> = {
  CREATED: ["LOADING", "EXITING"],
  LOADING: ["RUNNING", "EXITING"],
  RUNNING: ["PAUSED", "CHECKPOINTING", "EXITING"],
  PAUSED: ["RUNNING", "CHECKPOINTING", "EXITING"],
  CHECKPOINTING: ["RUNNING", "PAUSED", "EXITING"],
  EXITING: ["EXITED"],
  EXITED: [],
  FAILED: [],
};

function validTransition(previous: RuntimeState, next: RuntimeState) {
  if (next === "FAILED") {return previous !== "FAILED" && previous !== "EXITED";}
  return transitions[previous].includes(next);
}

function exitStarted(state: RuntimeState) {return state === "EXITING" || state === "EXITED";}

function stableError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {return error;}
  if (error instanceof Error && /^(?:ONS|PLAYER)_[A-Z0-9_]+$/u.test(error.message)) {return error;}
  return new Error("ONS_RUNTIME_FAILED");
}
