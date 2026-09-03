import type {
  CheckpointAvailability,
  GameRuntime,
  GameRuntimeEvent,
  RuntimeCapabilities,
  RuntimeCheckpoint,
  RuntimeLoadProgress,
  RuntimeState,
  RuntimeValidationProbe,
  RuntimeVideoMode,
} from "./contract.js";
import type { MountedRuntimeAdapter, RuntimeAdapterMount } from "./internal-adapter.js";

const unavailable: CheckpointAvailability = { available: false, blocker: "NOT_READY" };

export class GameRuntimeController implements GameRuntime {
  private readonly listeners = new Set<(event: GameRuntimeEvent) => void>();
  private adapter: MountedRuntimeAdapter | null = null;
  private state: RuntimeState = "CREATED";
  private mountCalled = false;
  private exitPromise: Promise<void> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private lastAvailability: CheckpointAvailability = unavailable;
  private availabilityTimer: number | null = null;
  private exitRequested = false;

  constructor(
    private readonly mountAdapter: RuntimeAdapterMount,
    private readonly capabilities: RuntimeCapabilities,
    private readonly abortSignal: AbortSignal | null,
  ) {
    abortSignal?.addEventListener("abort", this.abort, { once: true });
  }

  async mount(target: HTMLElement) {
    if (this.mountCalled || this.state !== "CREATED") {throw new Error("RUNTIME_INVALID_STATE");}
    this.mountCalled = true;
    if (this.abortSignal?.aborted) {
      await this.exit();
      throw new DOMException("Aborted", "AbortError");
    }
    this.transition("LOADING");
    try {
      const adapter = await this.mountAdapter(target, this.reportProgress, this.reportExitRequested);
      if (this.abortSignal?.aborted || exitHasStarted(this.state)) {
        await adapter.exit();
        throw new DOMException("Aborted", "AbortError");
      }
      this.adapter = adapter;
      this.transition("RUNNING");
      this.refreshAvailability();
      this.startAvailabilityPolling();
      this.emit({ type: "READY" });
    } catch (error) {
      await this.fail(error);
      throw stableError(error);
    }
  }

  pause() {return this.enqueue(() => this.performPause());}

  resume() {return this.enqueue(() => this.performResume());}

  checkpoint() {return this.enqueue(() => this.performCheckpoint());}

  private async performPause() {
    this.requireCapability("pause");
    this.requireState("RUNNING");
    await this.perform("RUNNING", "PAUSED", () => this.requireAdapter().pause());
  }

  private async performResume() {
    this.requireCapability("pause");
    this.requireState("PAUSED");
    await this.perform("PAUSED", "RUNNING", () => this.requireAdapter().resume());
  }

  private async performCheckpoint(): Promise<RuntimeCheckpoint> {
    this.requireCapability("checkpoint");
    if (exitHasStarted(this.state)) {throw new DOMException("Aborted", "AbortError");}
    if (this.state !== "RUNNING" && this.state !== "PAUSED") {throw new Error("RUNTIME_INVALID_STATE");}
    if (!this.getCheckpointAvailability().available) {throw new Error("CHECKPOINT_UNAVAILABLE");}
    const previous = this.state;
    this.transition("CHECKPOINTING");
    try {
      const payload = await this.requireAdapter().checkpoint();
      if (!payload.bytes.byteLength || !validCheckpointFormat(payload.format)) {
        throw new Error("CHECKPOINT_CREATE_FAILED");
      }
      this.assertOperationActive("CHECKPOINTING");
      this.transition(previous);
      this.refreshAvailability();
      return { bytes: payload.bytes.slice(), format: payload.format };
    } catch (error) {
      if (isCheckpointing(this.state)) {
        this.transition(previous);
        this.refreshAvailability();
      }
      throw stableError(error);
    }
  }

  async screenshot() {
    this.requireCapability("screenshot");
    if (this.state !== "RUNNING" && this.state !== "PAUSED") {throw new Error("RUNTIME_INVALID_STATE");}
    const screenshot = await this.requireAdapter().screenshot();
    if (!screenshot.size) {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
    return screenshot;
  }

  async exit() {
    this.exitPromise ??= this.performExit();
    return this.exitPromise;
  }

  getState() {return this.state;}
  getCapabilities() {return this.capabilities;}

  getCheckpointAvailability(): CheckpointAvailability {
    if (this.state === "FAILED") {return { available: false, blocker: "FAILED" };}
    if ((this.state !== "RUNNING" && this.state !== "PAUSED") || !this.adapter) {return unavailable;}
    return this.refreshAvailability();
  }

  getCanvas() {return this.adapter?.getCanvas() ?? null;}

  getFrameCount() {
    if (!this.capabilities.frameCounter || !this.adapter) {return null;}
    const value = this.adapter.getFrameCount();
    return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  getValidationProbe(kind: string): RuntimeValidationProbe | null {
    if (!this.capabilities.validationProbes.includes(kind) || !this.adapter) {return null;}
    const probe = this.adapter.getValidationProbe(kind);
    return probe?.kind === kind && Number.isSafeInteger(probe.schemaVersion) && probe.schemaVersion > 0
      ? structuredClone(probe)
      : null;
  }

  setVolume(value: number) {
    if (!this.capabilities.volume || !this.adapter?.setVolume) {throw new Error("RUNTIME_OPERATION_UNSUPPORTED");}
    if (!Number.isFinite(value) || value < 0 || value > 1) {throw new Error("RUNTIME_VOLUME_INVALID");}
    this.adapter.setVolume(value);
  }

  async setVideoMode(mode: RuntimeVideoMode) {
    if (!this.adapter?.setVideoMode) {throw new Error("RUNTIME_OPERATION_UNSUPPORTED");}
    await this.adapter.setVideoMode(mode);
  }

  subscribe(listener: (event: GameRuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  }

  private readonly abort = () => {void this.exit();};
  private readonly reportProgress = (progress: RuntimeLoadProgress) => {
    if (this.state !== "LOADING" || !validProgress(progress)) {return;}
    this.emit({ type: "LOAD_PROGRESS", ...progress });
  };
  private readonly reportExitRequested = () => {
    if (this.exitRequested || exitHasStarted(this.state) || this.state === "FAILED") {return;}
    this.exitRequested = true;
    this.emit({ type: "EXIT_REQUESTED" });
    void this.exit();
  };

  private enqueue<T>(operation: () => Promise<T>) {
    const pending = this.operationTail.then(operation);
    this.operationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async perform(expected: RuntimeState, next: RuntimeState, operation: () => Promise<void>) {
    try {
      await operation();
      this.assertOperationActive(expected);
      this.transition(next);
    } catch (error) {
      if (!exitHasStarted(this.state)) {await this.fail(error);}
      throw stableError(error);
    }
  }

  private async performExit() {
    if (this.state === "EXITED") {return;}
    const failed = this.state === "FAILED";
    if (!failed) {this.transition("EXITING");}
    let exitError: unknown;
    this.stopAvailabilityPolling();
    try {await this.adapter?.exit();} catch (error) {exitError = error;}
    this.adapter = null;
    this.abortSignal?.removeEventListener("abort", this.abort);
    if (!failed) {this.transition("EXITED");}
    this.listeners.clear();
    if (exitError) {throw stableError(exitError);}
  }

  private async fail(error: unknown) {
    this.stopAvailabilityPolling();
    const adapter = this.adapter;
    this.adapter = null;
    if (this.state !== "FAILED" && this.state !== "EXITED") {this.transition("FAILED");}
    try {await adapter?.exit();} catch { /* Preserve the original runtime failure. */ }
    this.emit({ type: "FATAL_ERROR", code: stableError(error).message });
  }

  private refreshAvailability() {
    const next = normalizedAvailability(this.requireAdapter().getCheckpointAvailability());
    if (next.available !== this.lastAvailability.available || next.blocker !== this.lastAvailability.blocker) {
      this.lastAvailability = next;
      this.emit({ type: "CHECKPOINT_AVAILABILITY_CHANGED", availability: next });
    }
    return next;
  }

  private startAvailabilityPolling() {
    this.availabilityTimer = window.setInterval(() => {
      if (this.state !== "RUNNING" && this.state !== "PAUSED") {return;}
      try {this.refreshAvailability();}
      catch (error) {if (!exitHasStarted(this.state)) {void this.fail(error);}}
    }, 250);
  }

  private stopAvailabilityPolling() {
    if (this.availabilityTimer !== null) {window.clearInterval(this.availabilityTimer);}
    this.availabilityTimer = null;
  }

  private requireAdapter() {
    if (!this.adapter) {throw new Error("RUNTIME_INVALID_STATE");}
    return this.adapter;
  }

  private requireState(expected: RuntimeState) {
    if (this.state !== expected) {throw new Error("RUNTIME_INVALID_STATE");}
  }

  private requireCapability(capability: "checkpoint" | "pause" | "screenshot") {
    if (!this.capabilities[capability]) {throw new Error("RUNTIME_OPERATION_UNSUPPORTED");}
  }

  private assertOperationActive(expected: RuntimeState) {
    if (this.state !== expected) {throw new DOMException("Aborted", "AbortError");}
  }

  private transition(next: RuntimeState) {
    if (!validTransition(this.state, next)) {throw new Error("RUNTIME_INVALID_STATE");}
    const previous = this.state;
    this.state = next;
    this.emit({ type: "STATE_CHANGED", previous, state: next });
  }

  private emit(event: GameRuntimeEvent) {for (const listener of this.listeners) {listener(event);}}
}

const transitions: Record<RuntimeState, readonly RuntimeState[]> = {
  CREATED: ["LOADING", "EXITING"], LOADING: ["RUNNING", "EXITING"],
  RUNNING: ["PAUSED", "CHECKPOINTING", "EXITING"], PAUSED: ["RUNNING", "CHECKPOINTING", "EXITING"],
  CHECKPOINTING: ["RUNNING", "PAUSED", "EXITING"], EXITING: ["EXITED"], EXITED: [], FAILED: [],
};

function validTransition(previous: RuntimeState, next: RuntimeState) {
  return next === "FAILED" ? previous !== "FAILED" && previous !== "EXITED" : transitions[previous].includes(next);
}
function exitHasStarted(state: RuntimeState) {return state === "EXITING" || state === "EXITED";}
function isCheckpointing(state: RuntimeState) {return state === "CHECKPOINTING";}
function validCheckpointFormat(value: string) {return /^[a-z0-9][a-z0-9.-]{0,63}$/u.test(value);}
function validProgress(value: RuntimeLoadProgress) {
  return Number.isSafeInteger(value.loadedBytes) && value.loadedBytes >= 0 &&
    (value.totalBytes === null || Number.isSafeInteger(value.totalBytes) && value.totalBytes >= value.loadedBytes);
}
function normalizedAvailability(value: CheckpointAvailability): CheckpointAvailability {
  if (value.available === true && value.blocker === null) {return value;}
  if (value.available === false && value.blocker !== null) {return value;}
  return { available: false, blocker: "FAILED" };
}
function stableError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {return error;}
  if (error instanceof Error && /^(?:RUNTIME|CHECKPOINT|PLAYER|RPG|ONS|KIRIKIRI|BUTTERSCOTCH|TYRANOSCRIPT|WASM4)_[A-Z0-9_]+$/u.test(error.message)) {
    return error;
  }
  return new Error("RUNTIME_FAILED");
}
