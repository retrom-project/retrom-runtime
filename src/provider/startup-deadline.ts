import {PlayerRuntimeError} from "./errors.js";

export type StartupTransfer = {progress(loadedBytes: number): void; complete(): void; fail(cause?: unknown): void};

/** Transfer inactivity and engine initialization have separate deadlines. */
export class StartupDeadline {
  private timer: number | null = null;
  private initialized = false;
  private stopped = false;
  private sequence = 0;
  private readonly transfers = new Map<number, number>();
  private readonly abort = () => this.stop();

  constructor(private readonly runtimeWindow: Window, private readonly signal: AbortSignal,
    private readonly failed: (error: PlayerRuntimeError) => void, private readonly initializationMs: number) {
    signal.addEventListener("abort", this.abort, {once: true});
    if (signal.aborted) {this.stop();} else {this.arm();}
  }

  initialize(): void {this.initialized = true; this.arm();}

  transfer(): StartupTransfer {
    const id = ++this.sequence;
    let loaded = 0;
    const arm = () => {
      if (this.stopped) {return;}
      this.clearTimer();
      const previous = this.transfers.get(id);
      if (previous !== undefined) {this.runtimeWindow.clearTimeout(previous);}
      this.transfers.set(id, this.runtimeWindow.setTimeout(() => this.fail("PLAYER_RESOURCE_IDLE_TIMEOUT"), 30_000));
    };
    const complete = () => {
      const timer = this.transfers.get(id);
      if (timer === undefined) {return;}
      this.runtimeWindow.clearTimeout(timer); this.transfers.delete(id); this.arm();
    };
    arm();
    return {
      progress: bytes => {if (Number.isSafeInteger(bytes) && bytes > loaded && this.transfers.has(id)) {loaded = bytes; arm();}},
      complete, fail: cause => this.fail("PLAYER_RESOURCE_NETWORK_FAILED", cause),
    };
  }

  fail(code: string, cause?: unknown): void {
    if (this.stopped) {return;}
    this.stop(); this.failed(new PlayerRuntimeError(code, {cause}));
  }

  stop(): void {
    this.stopped = true; this.clearTimer();
    for (const timer of this.transfers.values()) {this.runtimeWindow.clearTimeout(timer);}
    this.transfers.clear(); this.signal.removeEventListener("abort", this.abort);
  }

  private arm(): void {
    this.clearTimer();
    if (this.stopped || this.transfers.size) {return;}
    const code = this.initialized ? "PLAYER_CORE_INITIALIZATION_TIMEOUT" : "PLAYER_RESOURCE_IDLE_TIMEOUT";
    this.timer = this.runtimeWindow.setTimeout(() => this.fail(code), this.initialized ? this.initializationMs : 30_000);
  }

  private clearTimer(): void {
    if (this.timer !== null) {this.runtimeWindow.clearTimeout(this.timer); this.timer = null;}
  }
}

export function observeStartupErrors(runtimeWindow: Window, deadline: StartupDeadline): () => void {
  const failed = (event: ErrorEvent) => {event.preventDefault(); deadline.fail("PLAYER_RUNTIME_INITIALIZATION_FAILED", event.error);};
  const rejected = (event: PromiseRejectionEvent) => {event.preventDefault(); deadline.fail("PLAYER_RUNTIME_INITIALIZATION_FAILED", event.reason);};
  const violation = (event: SecurityPolicyViolationEvent) => {
    if (event.disposition === "enforce" && ["eval", "wasm-eval"].includes(event.blockedURI)) {
      deadline.fail("PLAYER_RUNTIME_CSP_BLOCKED");
    }
  };
  runtimeWindow.addEventListener("error", failed);
  runtimeWindow.addEventListener("unhandledrejection", rejected);
  runtimeWindow.document.addEventListener("securitypolicyviolation", violation);
  return () => {
    runtimeWindow.removeEventListener("error", failed);
    runtimeWindow.removeEventListener("unhandledrejection", rejected);
    runtimeWindow.document.removeEventListener("securitypolicyviolation", violation);
  };
}
