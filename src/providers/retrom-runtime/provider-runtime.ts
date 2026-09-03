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
import {PlayerRuntimeError} from "../../provider/errors.js";
import {RuntimeGamepadFilter, installRuntimeGamepadFilter} from "../../provider/gamepad-filter.js";
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
  private exitRequestedEmitted = false;
  private fatalEmitted = false;
  private runtimeWindow: Window | null = null;
  private inputFilter: RuntimeGamepadFilter | null = null;
  private cleanupInputFilter: (() => void) | null = null;

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
    if (!this.envelope.runtime.capabilities.pause) {throw capabilityError();}
    if (this.state === "PAUSED") {return;}
    if (this.state !== "RUNNING") {throw contractError();}
    const runtime = this.requireRuntime();
    await runtime.pause();
    this.transition("PAUSED");
  }

  async resume() {
    if (!this.envelope.runtime.capabilities.pause) {throw capabilityError();}
    if (this.state === "RUNNING") {return;}
    if (this.state !== "PAUSED") {throw contractError();}
    const runtime = this.requireRuntime();
    await runtime.resume();
    this.transition("RUNNING");
  }

  async checkpoint() {
    if (!this.envelope.runtime.capabilities.checkpoint) {throw capabilityError();}
    const contract = this.envelope.runtime.checkpoint;
    if (!contract || !this.getCheckpointAvailability().available) {throw contractError();}
    const checkpoint = await this.requireRuntime().checkpoint();
    if (!isUint8Array(checkpoint.bytes) || checkpoint.bytes.byteLength < 1 ||
      checkpoint.bytes.byteLength > contract.maxBytes || checkpoint.format !== contract.writeFormat) {
      throw contractError();
    }
    return {bytes: copyBytes(checkpoint.bytes), format: checkpoint.format, metadata: null};
  }

  screenshot() {
    if (!this.envelope.runtime.capabilities.screenshot) {return Promise.reject(capabilityError());}
    return this.requireRuntime().screenshot();
  }

  exit() {
    this.exitPromise ??= this.performExit();
    return this.exitPromise;
  }

  getState() {return this.state;}
  getCapabilities() {return this.envelope.runtime.capabilities;}

  getCheckpointAvailability() {
    if (!this.envelope.runtime.capabilities.checkpoint) {return {available: false, reason: "UNSUPPORTED"};}
    if (!this.runtime) {return {available: false, reason: "NOT_READY"};}
    const availability = this.runtime.getCheckpointAvailability();
    return {available: availability.available, reason: availability.blocker};
  }

  getCanvas() {return this.runtime?.getCanvas() ?? null;}
  getFrameCount() {return this.runtime?.getFrameCount() ?? null;}

  async setVolume(value: number) {
    if (!this.envelope.runtime.capabilities.volume) {throw capabilityError();}
    if (!Number.isFinite(value) || value < 0 || value > 1) {throw contractError();}
    await this.requireRuntime().setVolume(value);
  }

  async setVideoMode(mode: RuntimeVideoModeV1) {
    if (!this.envelope.runtime.capabilities.videoModes.includes(mode)) {throw capabilityError();}
    const canvas = this.requireRuntime().getCanvas();
    if (!canvas) {throw contractError();}
    canvas.style.setProperty("image-rendering", mode === "pixel" ? "pixelated" : "auto", "important");
  }
  async openNativeSettings(_panel: "controls" | "display" | "core") {throw capabilityError();}
  async closeNativeSettings() {throw capabilityError();}
  getDiscState(): Promise<RuntimeDiscStateV1> {return Promise.reject(capabilityError());}
  switchDisc(_index: number): Promise<RuntimeDiscStateV1> {return Promise.reject(capabilityError());}
  async setInputFilter(policy: RuntimeInputFilterPolicyV1 | null) {
    if (!this.envelope.runtime.capabilities.inputFilter) {throw capabilityError();}
    if (this.state === "FAILED" || this.state === "EXITED" || !validInputFilterPolicy(policy)) {
      throw contractError();
    }
    if (policy === null) {
      this.cleanupInputFilter?.();
      this.cleanupInputFilter = null;
      this.inputFilter = null;
      return;
    }
    if (this.inputFilter) {this.inputFilter.setPolicy(policy);}
    else {this.inputFilter = new RuntimeGamepadFilter(policy);}
    if (this.runtimeWindow && !this.cleanupInputFilter) {
      try {this.cleanupInputFilter = installRuntimeGamepadFilter(this.runtimeWindow, this.inputFilter);}
      catch (error) {throw contractError(error);}
    }
  }
  getNetplayPort(): Promise<RuntimeNetplayPortV1> {return Promise.reject(capabilityError());}
  async runValidationProbe(id: string, input: Record<string, unknown>): Promise<RuntimeValidationResultV1> {
    if (!this.envelope.runtime.capabilities.validationProbes.includes(id)) {throw capabilityError();}
    if (id !== "rpgmaker.position.v1" || !validRpgPosition(input)) {throw contractError();}
    const probe = this.requireRuntime().getValidationProbe(id);
    if (!probe || probe.kind !== id || probe.schemaVersion !== 1 || !validRpgPosition(probe.value)) {
      throw contractError();
    }
    const evidence = {...probe.value};
    return {
      evidence,
      passed: (Object.keys(evidence) as Array<keyof typeof evidence>).every((key) => evidence[key] === input[key]),
      probeId: id,
    };
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
      const runtimeWindow = frame?.contentWindow as Window | undefined ?? window;
      this.runtimeWindow = runtimeWindow;
      if (this.inputFilter) {this.cleanupInputFilter = installRuntimeGamepadFilter(runtimeWindow, this.inputFilter);}
      const config = projectLegacyRuntimeConfig(this.envelope, this.assetIndex);
      const runtime = this.factory(config, {
        frame: frame?.element,
        frameWindow: runtimeWindow,
        onDiagnostic: (diagnostic) => this.host.reportDiagnostic({
          code: providerDiagnosticCode(diagnostic.runtime), message: diagnostic.message,
        }),
        restorePayload,
        signal: this.host.signal,
      });
      this.runtime = runtime;
      this.unsubscribe = runtime.subscribe((event) => this.receive(event));
      await runtime.mount(target);
      if (this.state !== "FAILED" && this.state !== "EXITED") {this.transition("RUNNING");}
    } catch (error) {
      if (this.state !== "FAILED" && this.state !== "EXITED") {this.transition("FAILED");}
      await (this.exitPromise ??= this.performExit()).catch(() => undefined);
      throw error;
    }
  }

  private async performExit() {
    const preserveFailure = this.state === "FAILED";
    const runtime = this.runtime;
    this.unsubscribe?.();
    this.unsubscribe = null;
    let failure: unknown;
    try {if (runtime) {await runtime.exit();}}
    catch (error) {failure = error;}
    finally {
      this.cleanupInputFilter?.();
      this.cleanupInputFilter = null;
      this.inputFilter = null;
      this.runtime = null;
      this.runtimeWindow = null;
      if (!preserveFailure) {this.transition("EXITED");}
      this.listeners.clear();
    }
    if (failure) {throw failure;}
  }

  private requireRuntime() {
    if (!this.runtime || this.state === "CREATED" || this.state === "MOUNTING" ||
      this.state === "EXITED" || this.state === "FAILED") {
      throw contractError();
    }
    return this.runtime;
  }

  private receive(event: GameRuntimeEvent) {
    if (this.state === "FAILED" || this.state === "EXITED") {return;}
    if (event.type === "LOAD_PROGRESS") {
      this.emit({type: "LOAD_PROGRESS", loadedBytes: event.loadedBytes, totalBytes: event.totalBytes});
    } else if (event.type === "CHECKPOINT_AVAILABILITY_CHANGED") {
      this.emit({
        type: "CHECKPOINT_AVAILABILITY_CHANGED",
        availability: {available: event.availability.available, reason: event.availability.blocker},
      });
    } else if (event.type === "EXIT_REQUESTED") {
      if (!this.exitRequestedEmitted) {
        this.exitRequestedEmitted = true;
        this.emit({type: "EXIT_REQUESTED"});
      }
    } else if (event.type === "FATAL_ERROR") {
      if (!this.fatalEmitted) {
        this.fatalEmitted = true;
        this.transition("FAILED");
        this.emit({type: "FATAL_ERROR", code: event.code});
      }
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

function providerDiagnosticCode(runtime: string) {
  const suffix = runtime.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "").slice(0, 96);
  return suffix ? `RETROM_RUNTIME_${suffix}` : "RETROM_RUNTIME_DIAGNOSTIC";
}

function mapState(state: RuntimeState): RuntimeStateV1 | null {
  if (state === "CREATED") {return "CREATED";}
  if (state === "LOADING") {return "MOUNTING";}
  if (state === "RUNNING" || state === "PAUSED" || state === "EXITED" || state === "FAILED") {return state;}
  return null;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]";
}
function copyBytes(value: Uint8Array) {
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}
function validInputFilterPolicy(value: RuntimeInputFilterPolicyV1 | null) {
  return value === null || typeof value.suppressInput === "boolean" &&
    (value.activeGamepadIndex === null || Number.isSafeInteger(value.activeGamepadIndex) &&
      value.activeGamepadIndex >= 0 && value.activeGamepadIndex <= 255);
}
function validRpgPosition(value: unknown): value is {
  fixtureState: number; mapId: number; playerX: number; playerY: number;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "fixtureState,mapId,playerX,playerY") {return false;}
  const position = value as Record<string, unknown>;
  return Number.isSafeInteger(position.fixtureState) && Number.isSafeInteger(position.mapId) &&
    Number.isSafeInteger(position.playerX) && Number.isSafeInteger(position.playerY);
}
function contractError(cause?: unknown) {return new PlayerRuntimeError("PLAYER_RUNTIME_CONTRACT_INVALID", {cause});}
function capabilityError() {return new PlayerRuntimeError("PLAYER_RUNTIME_CAPABILITY_UNSUPPORTED");}
