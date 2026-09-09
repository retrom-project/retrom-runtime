import {startInputDiagnostics} from "../../provider/input-diagnostics.js";
import type {RuntimeInputDiagnosticsV1} from "../../provider/module-api.js";
import type {MountedRuntimeAdapter, RuntimeProgressReporter, RuntimeExitReporter} from "../../internal-adapter.js";
import type {
  AssetIndexV1, LaunchEnvelopeV1, PlayerRuntimeV1, RuntimeCheckpointAvailabilityV1, RuntimeCheckpointV1, RuntimeCheckpointRequestV1, RuntimeFinalSnapshotV1, RuntimeNativeSaveCapabilitiesV1,
  RuntimeDiscStateV1, RuntimeEventV1, RuntimeHostV1, RuntimeInputFilterPolicyV1,
  RuntimeNetplayPortV1, RuntimeStateV1, RuntimeVideoModeV1,
} from "../../provider/module-api.js";
import {PlayerRuntimeError} from "../../provider/errors.js";
import {focusRuntimeInput} from "../../provider/input-focus.js";
import {RuntimeGamepadFilter, installRuntimeGamepadFilter} from "../../provider/gamepad-filter.js";
import {installRuntimeFrameSurface, type RuntimeFrameSurface} from "./frame-surface.js";
import {mountTargetAdapter} from "./target-adapter.js";

export function createRetromRuntimePlayer(
  envelope: LaunchEnvelopeV1, host: RuntimeHostV1, assetIndex: AssetIndexV1,
): PlayerRuntimeV1 {
  return new RetromRuntimePlayer(envelope, host, assetIndex);
}

class RetromRuntimePlayer implements PlayerRuntimeV1 {
  private readonly listeners = new Set<(event: RuntimeEventV1) => void>();
  private state: RuntimeStateV1 = "CREATED";
  private adapter: MountedRuntimeAdapter | null = null;
  private exitPromise: Promise<void> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private availabilityTimer: number | null = null;
  private lastAvailability: RuntimeCheckpointAvailabilityV1 = {available: false, reason: "NOT_READY"};
  private inputDiagnostics: RuntimeInputDiagnosticsV1 | null = null;
  private runtimeWindow: Window | null = null;
  private inputFilter: RuntimeGamepadFilter | null = null;
  private cleanupInputFilter: (() => void) | null = null;
  private frameSurface: RuntimeFrameSurface | null = null;

  constructor(
    private readonly envelope: LaunchEnvelopeV1,
    private readonly host: RuntimeHostV1,
    private readonly assetIndex: AssetIndexV1,
  ) {
    host.signal.addEventListener("abort", this.abort, {once: true});
  }

  async mount(target: HTMLElement) {
    if (this.state !== "CREATED") {throw contractError();}
    try {
      this.assertActive();
      this.transition("MOUNTING");
      const restorePayload = await this.host.loadRestore(this.envelope.restore);
      this.assertActive();
      const frameMode = this.envelope.runtime.capabilities.frameMode;
      const frame = frameMode === "NONE"
        ? null
        : await this.host.mountFrame(target, {resourceRole: frameMode === "SAME_ORIGIN_BLANK" ? null : "game"});
      this.assertActive();
      const runtimeWindow = frame?.contentWindow as Window | undefined ?? window;
      this.runtimeWindow = runtimeWindow;
      const runtimeTarget = frameMode === "SAME_ORIGIN_BLANK"
        ? (this.frameSurface = installRuntimeFrameSurface(runtimeWindow, () => this.adapter?.getCanvas() ?? null,
          () => this.adapter?.canvasLayout === "CORE")).target
        : target;
      if (this.inputFilter) {this.cleanupInputFilter = installRuntimeGamepadFilter(runtimeWindow, this.inputFilter);}
      const adapter = await mountTargetAdapter(this.envelope, runtimeTarget, {
        assetIndex: this.assetIndex,
        signal: this.host.signal,
        reportFailure: (error) => {void this.fail(error);},
        frame: frame?.element,
        frameWindow: runtimeWindow,
        restorePayload,
        onDiagnostic: (diagnostic) => this.host.reportDiagnostic({
          code: providerDiagnosticCode(diagnostic.runtime), message: diagnostic.message,
        }),
        reportProgress: this.reportProgress,
        reportExitRequested: this.reportExitRequested,
      });
      if (this.stopping() || this.host.signal.aborted) {
        try {await adapter.exit();} catch (error) {this.reportCleanupFailure(error);}
        this.assertActive();
      }
      this.adapter = adapter;
      this.frameSurface?.refresh();
      this.transition("RUNNING");
      this.refreshAvailability();
      this.availabilityTimer = window.setInterval(this.pollAvailability, 250);
    } catch (error) {
      if (isAbort(error)) {await this.exit();} else {await this.fail(error);}
      throw stableError(error);
    }
  }

  pause() {return this.enqueue(() => this.changePause("PAUSED"));}
  resume() {return this.enqueue(() => this.changePause("RUNNING"));}

  checkpoint(request?: RuntimeCheckpointRequestV1) {
    return this.enqueue(async () => {
      this.requireCapability("checkpoint");
      const contract = this.envelope.runtime.checkpoint;
      const adapter = this.requireAdapter();
      if (!contract) {throw contractError();}
      const native = contract.semantics === "GAME_SAVE";
      const intent = request?.intent ?? (native ? "EXPORT" : "CAPTURE");
      if (intent !== "CAPTURE" && intent !== "EXPORT" || !native && intent !== "CAPTURE") {throw contractError();}
      const availability = this.getCheckpointAvailability();
      const allowed = native && intent === "CAPTURE"
        ? availability.save?.capture === "RUNTIME" && availability.save.captureAvailable
        : availability.available;
      if (!allowed) {throw contractError();}
      const previous = this.state;
      this.transition("CHECKPOINTING");
      this.refreshAvailability();
      try {
        const checkpoint = await adapter.checkpoint({intent});
        this.assertActive();
        return this.validateCheckpoint(checkpoint);
      } finally {
        if (this.state === "CHECKPOINTING") {
          this.transition(previous);
          this.refreshAvailability();
        }
      }
    });
  }

  screenshot() {
    return this.enqueue(async () => {
      this.requireCapability("screenshot");
      const screenshot = await this.requireAdapter().screenshot();
      this.assertActive();
      if (!screenshot.size) {throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");}
      return screenshot;
    });
  }

  acknowledgeCheckpoint(checkpoint: RuntimeCheckpointV1) {
    return this.enqueue(async () => {
      const adapter = this.requireAdapter();
      if (this.envelope.runtime.checkpoint?.semantics !== "GAME_SAVE" || !adapter.acknowledgeCheckpoint) {
        throw capabilityError();
      }
      await adapter.acknowledgeCheckpoint(checkpoint);
      this.assertActive();
      this.refreshAvailability();
    });
  }

  exit() {
    if (this.exitPromise) {return this.exitPromise;}
    const failed = this.state === "FAILED";
    // Store the shared promise before publishing a state event: a Host listener may reenter exit.
    this.exitPromise = Promise.resolve().then(() => this.performExit(failed));
    if (!failed) {this.transition("EXITING");}
    this.refreshAvailability();
    return this.exitPromise;
  }

  getState() {return this.state;}
  getCapabilities() {return this.envelope.runtime.capabilities;}
  getCheckpointAvailability() {return this.refreshAvailability();}
  getCanvas() {return this.adapter?.getCanvas() ?? null;}
  getFrameCount() {
    if (!this.envelope.runtime.capabilities.frameCounter) {return null;}
    const value = this.adapter?.getFrameCount() ?? null;
    return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  setVolume(value: number) {
    return this.enqueue(async () => {
      this.requireCapability("volume");
      if (!Number.isFinite(value) || value < 0 || value > 1) {throw contractError();}
      const adapter = this.requireAdapter();
      if (!adapter.setVolume) {throw capabilityError();}
      await adapter.setVolume(value);
      this.assertActive();
    });
  }

  setVideoMode(mode: RuntimeVideoModeV1) {
    return this.enqueue(async () => {
      if (!this.envelope.runtime.capabilities.videoModes.includes(mode)) {throw capabilityError();}
      const adapter = this.requireAdapter();
      const canvas = adapter.getCanvas();
      if (canvas) {
        canvas.style.setProperty("image-rendering", mode === "pixel" ? "pixelated" : "auto", "important");
      } else {
        if (!adapter.setVideoMode) {throw capabilityError();}
        await adapter.setVideoMode(mode);
        this.assertActive();
      }
    });
  }

  async openNativeSettings(_panel: "controls" | "display" | "core") {throw capabilityError();}
  async closeNativeSettings() {throw capabilityError();}
  getDiscState(): Promise<RuntimeDiscStateV1> {return Promise.reject(capabilityError());}
  switchDisc(_index: number): Promise<RuntimeDiscStateV1> {return Promise.reject(capabilityError());}
  getNetplayPort(): Promise<RuntimeNetplayPortV1> {return Promise.reject(capabilityError());}

  async setInputFilter(policy: RuntimeInputFilterPolicyV1 | null) {
    this.requireCapability("inputFilter");
    this.assertActive();
    if (!validInputFilterPolicy(policy)) {throw contractError();}
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

  startInputDiagnostics() {
    this.inputDiagnostics?.stop();
    this.inputDiagnostics = this.adapter?.startInputDiagnostics?.() ??
      startInputDiagnostics(this.runtimeWindow ?? window, () => this.getCanvas());
    return this.inputDiagnostics;
  }

  subscribe(listener: (event: RuntimeEventV1) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private readonly abort = () => {void this.exit().catch((error) => this.reportCleanupFailure(error));};
  private readonly reportProgress: RuntimeProgressReporter = (progress) => {
    if (this.state !== "MOUNTING" || !validProgress(progress)) {return;}
    this.emit({type: "LOAD_PROGRESS", loadedBytes: progress.loadedBytes, totalBytes: progress.totalBytes});
  };
  private readonly reportExitRequested: RuntimeExitReporter = (snapshot) => {
    if (this.stopping()) {return;}
    const exiting = this.exit();
    let finalSnapshot: RuntimeFinalSnapshotV1 | undefined;
    if (snapshot) {
      try {
        if (this.envelope.runtime.checkpoint?.semantics !== "GAME_SAVE") {throw contractError();}
        const checkpoint = this.validateCheckpoint(snapshot.checkpoint);
        const screenshot = snapshot.screenshot;
        if (screenshot !== null && (Object.prototype.toString.call(screenshot) !== "[object Blob]" ||
          !screenshot.size || screenshot.size > 16 * 1024 * 1024 || screenshot.type !== "image/png")) {throw contractError();}
        finalSnapshot = {checkpoint, screenshot};
      } catch {
        this.host.reportDiagnostic({code: "RETROM_RUNTIME_FINAL_SAVE_INVALID", message: "Final native save did not match the checkpoint contract"});
      }
    }
    this.emit({type: "EXIT_REQUESTED", ...(finalSnapshot ? {finalSnapshot} : {})});
    void exiting.catch((error) => this.reportCleanupFailure(error));
  };
  private readonly pollAvailability = () => {
    if (this.state !== "RUNNING" && this.state !== "PAUSED") {return;}
    try {this.refreshAvailability();} catch (error) {void this.fail(error);}
  };

  private async changePause(next: "PAUSED" | "RUNNING") {
    this.requireCapability("pause");
    const adapter = this.requireAdapter();
    if (this.state === next) {return;}
    try {
      await (next === "PAUSED" ? adapter.pause() : adapter.resume());
      this.assertActive();
      if (next === "RUNNING") {focusRuntimeInput(adapter.getCanvas(), this.runtimeWindow);}
      this.transition(next);
    } catch (error) {
      if (!this.stopping()) {await this.fail(error);}
      throw stableError(error);
    }
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const pending = this.operationTail.then(() => {this.assertActive(); return operation();});
    this.operationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async performExit(failed: boolean) {
    if (this.availabilityTimer !== null) {window.clearInterval(this.availabilityTimer);}
    this.availabilityTimer = null;
    this.inputDiagnostics?.stop();
    this.inputDiagnostics = null;
    const adapter = this.adapter;
    this.adapter = null;
    let failure: unknown;
    try {await adapter?.exit();} catch (error) {failure = error;}
    finally {
      this.host.signal.removeEventListener("abort", this.abort);
      this.cleanupInputFilter?.();
      this.cleanupInputFilter = null;
      this.inputFilter = null;
      this.frameSurface?.cleanup();
      this.frameSurface = null;
      this.runtimeWindow = null;
      if (!failed) {this.transition("EXITED");}
      this.listeners.clear();
    }
    if (failure) {throw stableError(failure);}
  }

  private async fail(error: unknown) {
    if (this.stopping()) {return;}
    this.transition("FAILED");
    this.emit({type: "FATAL_ERROR", code: stableError(error).message});
    try {await this.exit();} catch (cleanupError) {this.reportCleanupFailure(cleanupError);}
  }

  private reportCleanupFailure(error: unknown) {
    this.host.reportDiagnostic({code: "RETROM_RUNTIME_CLEANUP_FAILED", message: stableError(error).message});
  }

  private requireAdapter() {
    this.assertActive();
    if (!this.adapter || this.state !== "RUNNING" && this.state !== "PAUSED") {throw contractError();}
    return this.adapter;
  }

  private requireCapability(capability: "pause" | "checkpoint" | "screenshot" | "volume" | "inputFilter") {
    if (!this.envelope.runtime.capabilities[capability]) {throw capabilityError();}
  }

  private assertActive() {
    if (this.host.signal.aborted || this.stopping()) {throw new DOMException("Aborted", "AbortError");}
  }

  private stopping() {return this.state === "EXITING" || this.state === "EXITED" || this.state === "FAILED";}

  private refreshAvailability(): RuntimeCheckpointAvailabilityV1 {
    const next = this.currentAvailability();
    if (next.available !== this.lastAvailability.available || next.reason !== this.lastAvailability.reason ||
      next.revision !== this.lastAvailability.revision || next.save?.capture !== this.lastAvailability.save?.capture ||
      next.save?.restore !== this.lastAvailability.save?.restore || next.save?.captureAvailable !== this.lastAvailability.save?.captureAvailable ||
      next.save?.dataKind !== this.lastAvailability.save?.dataKind) {
      this.lastAvailability = next;
      this.emit({type: "CHECKPOINT_AVAILABILITY_CHANGED", availability: next});
    }
    return next;
  }

  private currentAvailability(): RuntimeCheckpointAvailabilityV1 {
    if (!this.envelope.runtime.capabilities.checkpoint) {return {available: false, reason: "UNSUPPORTED"};}
    if (this.state === "FAILED") {return {available: false, reason: "FAILED"};}
    if (this.state === "CHECKPOINTING") {return {available: false, reason: "BUSY"};}
    if (!this.adapter || this.state !== "RUNNING" && this.state !== "PAUSED") {
      return {available: false, reason: "NOT_READY"};
    }
    const value = this.adapter.getCheckpointAvailability();
    if (!validNativeSave(value.save, this.envelope.runtime.checkpoint?.semantics === "GAME_SAVE")) {
      return {available: false, reason: "FAILED"};
    }
    if (value.available === true && value.blocker === null || value.available === false && value.blocker !== null) {
      return {available: value.available, reason: value.blocker,
        ...(value.available && value.revision ? {revision: value.revision} : {}), ...(value.save ? {save: {...value.save}} : {})};
    }
    return {available: false, reason: "FAILED"};
  }

  private validateCheckpoint(checkpoint: {bytes: Uint8Array; format: string}): RuntimeCheckpointV1 {
    const contract = this.envelope.runtime.checkpoint;
    if (!contract || !isUint8Array(checkpoint.bytes) || checkpoint.bytes.byteLength < 1 ||
      checkpoint.bytes.byteLength > contract.maxBytes || checkpoint.format !== contract.writeFormat) {throw contractError();}
    return {bytes: Uint8Array.from(checkpoint.bytes), format: checkpoint.format, metadata: null};
  }

  private transition(next: RuntimeStateV1) {
    if (next === this.state) {return;}
    const previous = this.state;
    this.state = next;
    this.emit({type: "STATE_CHANGED", previous, state: next});
  }

  private emit(event: RuntimeEventV1) {for (const listener of this.listeners) {listener(event);}}
}

function validNativeSave(value: RuntimeNativeSaveCapabilitiesV1 | undefined, native: boolean) {
  return value === undefined || native && ["RUNTIME", "IN_GAME"].includes(value.capture) &&
    ["AUTOMATIC", "IN_GAME"].includes(value.restore) && typeof value.captureAvailable === "boolean" &&
    (value.capture === "RUNTIME" || !value.captureAvailable) &&
    (value.dataKind === undefined || value.dataKind === "PROGRESS" || value.dataKind === "STORAGE");
}
function providerDiagnosticCode(runtime: string) {
  const suffix = runtime.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "").slice(0, 96);
  return suffix ? `RETROM_RUNTIME_${suffix}` : "RETROM_RUNTIME_DIAGNOSTIC";
}
function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]";
}
function validInputFilterPolicy(value: RuntimeInputFilterPolicyV1 | null) {
  return value === null || typeof value.suppressInput === "boolean" &&
    (value.activeGamepadIndex === null || Number.isSafeInteger(value.activeGamepadIndex) &&
      value.activeGamepadIndex >= 0 && value.activeGamepadIndex <= 255);
}
function validProgress(value: {loadedBytes: number; totalBytes: number | null}) {
  return Number.isSafeInteger(value.loadedBytes) && value.loadedBytes >= 0 &&
    (value.totalBytes === null || Number.isSafeInteger(value.totalBytes) && value.totalBytes >= value.loadedBytes);
}
function isAbort(error: unknown) {return error instanceof DOMException && error.name === "AbortError";}
function stableError(error: unknown) {
  if (isAbort(error)) {return error as DOMException;}
  if (error instanceof Error && /^(?:RUNTIME|CHECKPOINT|PLAYER|PROVIDER|RPG|ONS|KIRIKIRI|BUTTERSCOTCH|TYRANOSCRIPT|WASM4|J2ME|SCUMMVM|FANTASY|WEBMSX|PX68K|OPENBOR)_[A-Z0-9_]+$/u.test(error.message)) {
    return error;
  }
  return new Error("RUNTIME_FAILED");
}
function contractError(cause?: unknown) {return new PlayerRuntimeError("PLAYER_RUNTIME_CONTRACT_INVALID", {cause});}
function capabilityError() {return new PlayerRuntimeError("PLAYER_RUNTIME_CAPABILITY_UNSUPPORTED");}
