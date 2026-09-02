import type {RuntimeConfig} from "../../catalog.js";
import type {GameRuntime, GameRuntimeEvent, RuntimeState} from "../../contract.js";
import type {RuntimeOptions} from "../../index.js";
import type {
  AssetIndexV1,
  LaunchEnvelopeV1,
  PlayerRuntimeV1,
  RuntimeDiscStateV1,
  RuntimeEventV1,
  RuntimeHostV1,
  RuntimeInputFilterPolicyV1,
  RuntimeNetplayPortV1,
  RuntimeStateV1,
  RuntimeValidationResultV1,
  RuntimeVideoModeV1,
} from "../../provider/module-api.js";
import {projectLegacyRuntimeConfig} from "./module-config.js";

type LegacyRuntimeFactory = (config: RuntimeConfig, options: RuntimeOptions) => GameRuntime;

export async function createRetromRuntimePlayer(
  envelope: LaunchEnvelopeV1,
  host: RuntimeHostV1,
  assetIndex: AssetIndexV1,
  factory: LegacyRuntimeFactory,
): Promise<PlayerRuntimeV1> {
  return new RetromRuntimePlayer(envelope, host, assetIndex, factory);
}

class RetromRuntimePlayer implements PlayerRuntimeV1 {
  private readonly listeners = new Set<(event: RuntimeEventV1) => void>();
  private state: RuntimeStateV1 = "CREATED";
  private runtime: GameRuntime | null = null;
  private unsubscribe: (() => void) | null = null;
  private mountPromise: Promise<void> | null = null;
  private exitPromise: Promise<void> | null = null;

  constructor(
    private readonly envelope: LaunchEnvelopeV1,
    private readonly host: RuntimeHostV1,
    private readonly assetIndex: AssetIndexV1,
    private readonly factory: LegacyRuntimeFactory,
  ) {}

  mount(target: HTMLElement) {
    if (this.mountPromise || this.state !== "CREATED") {return Promise.reject(contractError());}
    this.mountPromise = this.performMount(target);
    return this.mountPromise;
  }

  async pause() {
    const runtime = this.requireRuntime();
    await runtime.pause();
    this.transition("PAUSED");
  }

  async resume() {
    const runtime = this.requireRuntime();
    await runtime.resume();
    this.transition("RUNNING");
  }

  async checkpoint() {
    const checkpoint = await this.requireRuntime().checkpoint();
    return {bytes: checkpoint.bytes, format: checkpoint.format, metadata: null};
  }

  screenshot() {return this.requireRuntime().screenshot();}

  exit() {
    this.exitPromise ??= this.performExit();
    return this.exitPromise;
  }

  getState() {return this.state;}
  getCapabilities() {return this.envelope.runtime.capabilities;}

  getCheckpointAvailability() {
    if (!this.runtime) {return {available: false, reason: "NOT_READY"};}
    const availability = this.runtime.getCheckpointAvailability();
    return {available: availability.available, reason: availability.blocker};
  }

  getCanvas() {return this.runtime?.getCanvas() ?? null;}
  getFrameCount() {return this.runtime?.getFrameCount() ?? null;}

  async setVolume(value: number) {this.requireRuntime().setVolume(value);}

  async setVideoMode(_mode: RuntimeVideoModeV1) {throw capabilityError();}
  async openNativeSettings(_panel: "controls" | "display" | "core") {throw capabilityError();}
  async closeNativeSettings() {throw capabilityError();}
  getDiscState(): Promise<RuntimeDiscStateV1> {return Promise.reject(capabilityError());}
  switchDisc(_index: number): Promise<RuntimeDiscStateV1> {return Promise.reject(capabilityError());}
  async setInputFilter(_policy: RuntimeInputFilterPolicyV1 | null) {throw capabilityError();}
  getNetplayPort(): Promise<RuntimeNetplayPortV1> {return Promise.reject(capabilityError());}
  runValidationProbe(_id: string, _input: Record<string, unknown>): Promise<RuntimeValidationResultV1> {
    return Promise.reject(capabilityError());
  }

  subscribe(listener: (event: RuntimeEventV1) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async performMount(target: HTMLElement) {
    this.transition("MOUNTING");
    try {
      const restorePayload = await this.host.loadRestore(this.envelope.restore);
      const frame = this.envelope.runtime.capabilities.frameMode === "NONE"
        ? null
        : await this.host.mountFrame(target, {resourceRole: "game"});
      const config = projectLegacyRuntimeConfig(this.envelope, this.assetIndex);
      const runtime = this.factory(config, {
        frame: frame?.element,
        frameWindow: frame?.contentWindow ?? window,
        onDiagnostic: (diagnostic) => this.host.reportDiagnostic({code: diagnostic.runtime, message: diagnostic.message}),
        restorePayload,
        signal: this.host.signal,
      });
      this.runtime = runtime;
      this.unsubscribe = runtime.subscribe((event) => this.receive(event));
      await runtime.mount(target);
      if (this.state !== "FAILED" && this.state !== "EXITED") {this.transition("RUNNING");}
    } catch (error) {
      this.transition("FAILED");
      await this.runtime?.exit().catch(() => undefined);
      throw error;
    }
  }

  private async performExit() {
    const runtime = this.runtime;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (runtime) {await runtime.exit();}
    this.transition("EXITED");
    this.listeners.clear();
  }

  private requireRuntime() {
    if (!this.runtime || this.state === "CREATED" || this.state === "MOUNTING" ||
      this.state === "EXITED" || this.state === "FAILED") {
      throw contractError();
    }
    return this.runtime;
  }

  private receive(event: GameRuntimeEvent) {
    if (event.type === "LOAD_PROGRESS") {
      this.emit({type: "LOAD_PROGRESS", loadedBytes: event.loadedBytes, totalBytes: event.totalBytes});
    } else if (event.type === "EXIT_REQUESTED") {
      this.emit({type: "EXIT_REQUESTED"});
    } else if (event.type === "FATAL_ERROR") {
      this.transition("FAILED");
      this.emit({type: "FATAL_ERROR", code: event.code});
    } else if (event.type === "STATE_CHANGED") {
      const mapped = mapState(event.state);
      if (mapped) {this.transition(mapped);}
    }
  }

  private transition(next: RuntimeStateV1) {
    if (next === this.state) {return;}
    const previous = this.state;
    this.state = next;
    this.emit({type: "STATE_CHANGED", previous, state: next});
  }

  private emit(event: RuntimeEventV1) {for (const listener of this.listeners) {listener(event);}}
}

function mapState(state: RuntimeState): RuntimeStateV1 | null {
  if (state === "CREATED") {return "CREATED";}
  if (state === "LOADING") {return "MOUNTING";}
  if (state === "RUNNING" || state === "PAUSED" || state === "EXITED" || state === "FAILED") {return state;}
  return null;
}

function contractError() {return new Error("PLAYER_RUNTIME_CONTRACT_INVALID");}
function capabilityError() {return new Error("PLAYER_RUNTIME_CAPABILITY_UNSUPPORTED");}
