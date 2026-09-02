import type {
  AssetIndexV1,
  LaunchEnvelopeV1,
  PlayerRuntimeV1,
  RuntimeDiscStateV1,
  RuntimeEventV1,
  RuntimeHostV1,
  RuntimeInputFilterPolicyV1,
  RuntimeMultiDiscResourceV1,
  RuntimeNetplayPortV1,
  RuntimeStateV1,
  RuntimeValidationResultV1,
  RuntimeVideoModeV1,
} from "../../provider/module-api.js";
import {PlayerRuntimeError} from "../../provider/errors.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {installArchiveWorkerCompatibility} from "./archive-worker.js";
import {installDOSBoxPureStateCompatibility} from "./dosbox-state.js";
import {installExternalFileCompatibility} from "./external-files.js";
import {RuntimeGamepadFilter, installRuntimeGamepadFilter} from "../../provider/gamepad-filter.js";
import {installEmulatorJs423NetplayCompatibility} from "./netplay-compatibility.js";
import {EmulatorJsNetplayPort, type EmulatorNetplayInstance} from "./netplay-port.js";
import {
  type EmulatorJsNetplayProfileDeclaration,
  type ValidatedEmulatorJsNetplayProfile,
  validateEmulatorJsNetplayProfile,
} from "./netplay-profile.js";
import {
  type EmulatorDiscInstance,
  initializeEmulatorJsDiscs,
  readEmulatorJsDiscState,
  switchEmulatorJsDisc,
} from "./discs.js";
import {captureEmulatorJsScreenshot} from "./screenshot.js";
import {createStartBarrier, startWhenAvailable, type StartBarrier} from "./lifecycle.js";
import {installEmulatorJs423StateRestoreCompatibility} from "./state-restore.js";
import {createRetromDefaultControls, type EmulatorDefaultControls} from "./default-controls.js";
import {
  closeEmulatorJsNativeSettings,
  type EmulatorNativeSettingsInstance,
  openEmulatorJsNativeSettings,
} from "./native-settings.js";
import {retromShaders} from "./shaders.js";
import {applyEmulatorJsVideoMode} from "./video-mode.js";
import {biosFile, externalFiles, fileName, optionalResource, resource, runtimeBase} from "./resources.js";

type EjsManager = {
  Module?: {
    HEAPU8?: Uint8Array;
    UTF8ToString?: (pointer: number) => string;
    _free?: (pointer: number) => void;
    _save_state_info?: () => number;
  };
  FS?: {
    readFile?: (path: string) => ArrayBufferView;
    stat?: (path: string) => {size: number};
    unlink?: (path: string) => void;
    writeFile?: (path: string, bytes: Uint8Array) => void;
  };
  clearEJSResetTimer?: () => void;
  functions?: {loadState?: (path: string, slot: number) => unknown; screenshot?: () => void};
  getFrameNum?: () => number;
  getState?: () => Uint8Array;
  getStateAsync?: () => Promise<Uint8Array>;
  loadExplicitStateAndWait?: (state: Uint8Array) => Promise<void>;
  loadStateAndWait?: (state: Uint8Array) => Promise<unknown>;
  loadState?: (state: Uint8Array) => void;
  getVideoDimensions?: (dimension: "aspect") => number | undefined;
  toggleMainLoop?: (running: boolean) => void;
};

type EjsInstance = EmulatorDiscInstance & EmulatorNativeSettingsInstance & EmulatorNetplayInstance & {
  canvas?: HTMLCanvasElement;
  capture?: {photo?: {source?: string; format?: string; upscale?: number}};
  gameManager?: EjsManager;
  paused?: boolean;
  muted?: boolean;
  volume?: number;
  setVolume?: (value: number) => void;
  changeSettingOption?: (name: string, value: string) => void;
  enableShader?: (name: string) => void;
  takeScreenshot?: (source: string, format: string, upscale: number) => Promise<{blob: Blob; format: string}>;
  downloadType?: {rom?: {dontExtractIfCore?: string[]}};
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
};

type EjsWindow = Window & {
  EJS_player?: string;
  EJS_core?: string;
  EJS_gameUrl?: string;
  EJS_gameName?: string;
  EJS_gameID?: number;
  EJS_pathtodata?: string;
  EJS_biosUrl?: string;
  EJS_gameParentUrl?: string;
  EJS_startOnLoaded?: boolean;
  EJS_dontExtractRom?: boolean;
  EJS_disableBatchBootup?: boolean;
  EJS_language?: string;
  EJS_disableAutoLang?: boolean;
  EJS_DEBUG_XX?: boolean;
  EJS_EXPERIMENTAL_NETPLAY?: boolean;
  EJS_threads?: boolean;
  EJS_fullscreenOnLoaded?: boolean;
  EJS_disableDatabases?: boolean;
  EJS_disableLocalStorage?: boolean;
  EJS_CacheLimit?: number;
  EJS_Buttons?: Record<string, boolean>;
  EJS_defaultControls?: EmulatorDefaultControls;
  EJS_defaultOptions?: Record<string, string>;
  EJS_shaders?: typeof retromShaders;
  EJS_paths?: Record<string, string>;
  EJS_externalFiles?: Record<string, string>;
  EJS_ready?: () => void;
  EJS_onGameStart?: () => void;
  EJS_emulator?: EjsInstance;
};

type EmulatorImplementation = {
  artifactFlavor: "WASM" | "THREAD_WASM" | "OVERRIDE";
  coreAssetPath: string;
  coreSha256: string;
  coreSizeBytes: number;
  defaultOptions: Readonly<Record<string, string>>;
  netplayProfile: EmulatorJsNetplayProfileDeclaration | null;
  release: "4.2.3" | "4.3.0-pre";
  runtimeCore: string;
  startupActions: ReadonlyArray<{
    delayMs: number;
    player: number;
    control: number;
    durationMs: number;
  }>;
};

const configuredGlobals = [
  "EJS_player", "EJS_core", "EJS_gameUrl", "EJS_gameName", "EJS_gameID", "EJS_pathtodata",
  "EJS_biosUrl", "EJS_gameParentUrl", "EJS_startOnLoaded", "EJS_dontExtractRom",
  "EJS_disableBatchBootup", "EJS_language", "EJS_disableAutoLang", "EJS_DEBUG_XX",
  "EJS_EXPERIMENTAL_NETPLAY", "EJS_threads", "EJS_fullscreenOnLoaded", "EJS_disableDatabases",
  "EJS_disableLocalStorage", "EJS_CacheLimit", "EJS_Buttons", "EJS_defaultControls",
  "EJS_defaultOptions", "EJS_shaders", "EJS_paths",
  "EJS_externalFiles", "EJS_ready", "EJS_onGameStart",
] as const;

export async function createEmulatorJsPlayer(
  envelope: LaunchEnvelopeV1,
  host: RuntimeHostV1,
  assetIndex: AssetIndexV1,
): Promise<PlayerRuntimeV1> {
  return new EmulatorJsPlayer(envelope, host, assetIndex);
}

class EmulatorJsPlayer implements PlayerRuntimeV1 {
  private readonly listeners = new Set<(event: RuntimeEventV1) => void>();
  private state: RuntimeStateV1 = "CREATED";
  private runtimeWindow: EjsWindow | null = null;
  private instance: EjsInstance | null = null;
  private loader: HTMLScriptElement | null = null;
  private restorePayload: Uint8Array | null = null;
  private mountPromise: Promise<void> | null = null;
  private exitPromise: Promise<void> | null = null;
  private cleanupArchiveWorker: (() => void) | null = null;
  private cleanupStateRestore: (() => void) | null = null;
  private cleanupExternalFiles: (() => void) | null = null;
  private cleanupInputFilter: (() => void) | null = null;
  private inputFilter: RuntimeGamepadFilter | null = null;
  private cleanupNetplayCompatibility: (() => void) | null = null;
  private netplayPort: EmulatorJsNetplayPort | null = null;
  private dosboxCompatibility: ReturnType<typeof installDOSBoxPureStateCompatibility> | null = null;
  private cleanupDeferredStart: (() => void) | null = null;
  private startBarrier: StartBarrier | null = null;
  private startTimeout: number | null = null;
  private readonly startupTimers = new Set<number>();
  private startObserved = false;
  private exitRequestedEmitted = false;
  private checkpointAvailability = {available: false, reason: "NOT_READY" as string | null};
  private readonly implementation: EmulatorImplementation;
  private readonly netplayProfile: ValidatedEmulatorJsNetplayProfile | null;
  private readonly hostAbort = () => {void this.exit();};

  constructor(
    private readonly envelope: LaunchEnvelopeV1,
    private readonly host: RuntimeHostV1,
    private readonly assetIndex: AssetIndexV1,
  ) {
    const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === envelope.runtime.targetId);
    if (!target) {invalid();}
    this.implementation = target.implementation as EmulatorImplementation;
    const core = assetIndex[this.implementation.coreAssetPath];
    if (!core || core.sha256 !== this.implementation.coreSha256 ||
      core.sizeBytes !== this.implementation.coreSizeBytes) {
      invalid();
    }
    try {this.netplayProfile = validateEmulatorJsNetplayProfile(envelope, this.implementation);}
    catch {invalid();}
  }

  mount(target: HTMLElement) {
    if (this.mountPromise || this.state !== "CREATED") {return Promise.reject(contractError());}
    this.mountPromise = this.performMount(target);
    return this.mountPromise;
  }

  async pause() {
    if (!this.envelope.runtime.capabilities.pause) {throw capabilityError();}
    if (this.state === "PAUSED") {return;}
    if (this.state !== "RUNNING") {throw contractError();}
    const instance = this.requireInstance();
    const toggle = instance.gameManager?.toggleMainLoop;
    if (!toggle) {throw contractError();}
    toggle.call(instance.gameManager, false);
    instance.paused = true;
    this.transition("PAUSED");
  }

  async resume() {
    if (!this.envelope.runtime.capabilities.pause) {throw capabilityError();}
    if (this.state === "RUNNING") {return;}
    if (this.state !== "PAUSED") {throw contractError();}
    const instance = this.requireInstance();
    const toggle = instance.gameManager?.toggleMainLoop;
    if (!toggle) {throw contractError();}
    toggle.call(instance.gameManager, true);
    instance.paused = false;
    this.transition("RUNNING");
  }

  async checkpoint() {
    const manager = this.requireInstance().gameManager;
    const bytes = manager?.getStateAsync ? await manager.getStateAsync() : manager?.getState?.();
    const maximum = this.envelope.runtime.checkpoint?.maxBytes ?? 0;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maximum) {
      throw contractError();
    }
    return {bytes: new Uint8Array(bytes), format: "emulatorjs-state-v1", metadata: null};
  }

  async screenshot() {
    return captureEmulatorJsScreenshot(this.requireInstance());
  }

  exit() {
    this.exitPromise ??= this.performExit();
    return this.exitPromise;
  }

  getState() {return this.state;}
  getCapabilities() {return this.envelope.runtime.capabilities;}
  getCheckpointAvailability() {return {...this.checkpointAvailability};}
  getCanvas() {return this.instance?.canvas ?? null;}
  getFrameCount() {return this.instance?.gameManager?.getFrameNum?.() ?? null;}

  async setVolume(value: number) {
    if (!this.envelope.runtime.capabilities.volume) {throw capabilityError();}
    const instance = this.requireInstance();
    if (!Number.isFinite(value) || value < 0 || value > 1 || !instance.setVolume) {throw contractError();}
    instance.setVolume(value);
  }

  async setVideoMode(mode: RuntimeVideoModeV1) {
    if (!this.envelope.runtime.capabilities.videoModes.includes(mode)) {throw capabilityError();}
    if (!applyEmulatorJsVideoMode(this.requireInstance(), mode)) {throw contractError();}
  }
  async openNativeSettings(panel: "controls" | "display" | "core") {
    if (!this.envelope.runtime.capabilities.nativeSettings) {throw capabilityError();}
    if (!openEmulatorJsNativeSettings(this.requireInstance(), panel)) {throw contractError();}
  }
  async closeNativeSettings() {
    if (!this.envelope.runtime.capabilities.nativeSettings) {throw capabilityError();}
    closeEmulatorJsNativeSettings(this.requireInstance());
  }
  async getDiscState(): Promise<RuntimeDiscStateV1> {
    if (!this.envelope.runtime.capabilities.discSwitch) {throw capabilityError();}
    return readEmulatorJsDiscState(this.requireInstance(), this.requireDiscResource());
  }
  async switchDisc(index: number): Promise<RuntimeDiscStateV1> {
    if (!this.envelope.runtime.capabilities.discSwitch) {throw capabilityError();}
    const instance = this.requireInstance();
    const resourceValue = this.requireDiscResource();
    let result: ReturnType<typeof switchEmulatorJsDisc>;
    try {
      const before = readEmulatorJsDiscState(instance, resourceValue);
      if (before.currentIndex === index) {return before;}
      const manager = instance.gameManager;
      if (!manager?.toggleMainLoop) {throw new Error("PLAYER_DISC_RUNTIME_INVALID");}
      const wasPaused = this.state === "PAUSED";
      manager.toggleMainLoop(false);
      try {result = switchEmulatorJsDisc(instance, resourceValue, index);}
      finally {
        manager.toggleMainLoop(!wasPaused);
        instance.paused = wasPaused;
      }
    } catch (error) {throw contractError(error);}
    if (result.changed) {this.emit({type: "DISC_CHANGED", state: result.state});}
    return result.state;
  }
  async setInputFilter(policy: RuntimeInputFilterPolicyV1 | null) {
    if (!this.envelope.runtime.capabilities.inputFilter) {throw capabilityError();}
    if (this.envelope.session.mode === "NETPLAY") {throw contractError();}
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
  async getNetplayPort(): Promise<RuntimeNetplayPortV1> {
    if (!this.envelope.runtime.capabilities.netplayPort) {throw capabilityError();}
    if (!this.netplayProfile) {throw contractError();}
    const instance = this.requireInstance();
    try {
      this.netplayPort ??= new EmulatorJsNetplayPort(instance, this.netplayProfile.maxStateBytes);
      return this.netplayPort;
    } catch (error) {throw contractError(error);}
  }
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
      this.restorePayload = await this.host.loadRestore(this.envelope.restore);
      const frame = await this.host.mountFrame(target, {resourceRole: null});
      const runtimeWindow = frame.contentWindow as EjsWindow;
      this.runtimeWindow = runtimeWindow;
      this.startBarrier = createStartBarrier();
      this.configure(runtimeWindow);
      if (this.netplayProfile) {
        this.cleanupNetplayCompatibility = installEmulatorJs423NetplayCompatibility(runtimeWindow);
      }
      this.cleanupArchiveWorker = installArchiveWorkerCompatibility(
        runtimeWindow,
        this.implementation.release,
        runtimeBase(this.envelope, this.implementation.release),
      );
      if (this.implementation.release === "4.2.3" && Object.keys(externalFiles(this.envelope)).length) {
        this.cleanupExternalFiles = installExternalFileCompatibility(runtimeWindow);
      }
      if (this.restorePayload && this.implementation.release === "4.2.3") {
        this.cleanupStateRestore = installEmulatorJs423StateRestoreCompatibility(runtimeWindow);
      }
      if (this.implementation.release === "4.3.0-pre" && this.implementation.runtimeCore === "dosbox_pure") {
        this.dosboxCompatibility = installDOSBoxPureStateCompatibility(runtimeWindow);
      }
      if (this.inputFilter) {
        this.cleanupInputFilter = installRuntimeGamepadFilter(runtimeWindow, this.inputFilter);
      }
      const loader = runtimeWindow.document.createElement("script");
      loader.async = true;
      loader.dataset.retromLoader = "true";
      loader.src = `${runtimeBase(this.envelope, this.implementation.release)}loader.js`;
      runtimeWindow.document.head.append(loader);
      this.loader = loader;
      loader.addEventListener("error", () => this.fail("PLAYER_RUNTIME_LOADER_FAILED"), {once: true});
      this.startTimeout = runtimeWindow.setTimeout(() => this.fail("PLAYER_RUNTIME_START_TIMEOUT"), 30_000);
      this.host.signal.addEventListener("abort", this.hostAbort, {once: true});
      await this.startBarrier.promise;
      this.clearStartBarrier();
      this.transition("RUNNING");
    } catch (error) {
      if (this.state !== "FAILED" && this.state !== "EXITED") {this.transition("FAILED");}
      await (this.exitPromise ??= this.performExit());
      throw error;
    }
  }

  private configure(runtimeWindow: EjsWindow) {
    const game = resource(this.envelope, "game", "ROM_BLOB_V1");
    const bios = optionalResource(this.envelope, "bios", "BIOS_BUNDLE_V1");
    const parent = optionalResource(this.envelope, "parent", "PARENT_ARCHIVE_V1");
    const releaseBase = runtimeBase(this.envelope, this.implementation.release);
    const deferredDOSStart = this.implementation.release === "4.3.0-pre" &&
      this.implementation.runtimeCore === "dosbox_pure";
    runtimeWindow.EJS_player = "#retrom-emulator";
    runtimeWindow.EJS_core = this.implementation.runtimeCore;
    runtimeWindow.EJS_gameUrl = game.url;
    runtimeWindow.EJS_gameName = this.envelope.session.title;
    runtimeWindow.EJS_gameID = 0;
    runtimeWindow.EJS_pathtodata = releaseBase;
    runtimeWindow.EJS_biosUrl = biosFile(bios);
    runtimeWindow.EJS_gameParentUrl = parent?.url;
    runtimeWindow.EJS_startOnLoaded = !deferredDOSStart;
    runtimeWindow.EJS_dontExtractRom = deferredDOSStart;
    runtimeWindow.EJS_disableBatchBootup = deferredDOSStart;
    runtimeWindow.EJS_language = "zh-CN";
    runtimeWindow.EJS_disableAutoLang = false;
    runtimeWindow.EJS_DEBUG_XX = this.restorePayload !== null || this.envelope.session.mode === "NETPLAY";
    runtimeWindow.EJS_EXPERIMENTAL_NETPLAY = false;
    runtimeWindow.EJS_threads = this.envelope.runtime.capabilities.requiresThreads;
    runtimeWindow.EJS_fullscreenOnLoaded = false;
    runtimeWindow.EJS_disableDatabases = true;
    runtimeWindow.EJS_disableLocalStorage = true;
    runtimeWindow.EJS_CacheLimit = 0;
    runtimeWindow.EJS_Buttons = {exitEmulation: false};
    runtimeWindow.EJS_defaultControls = createRetromDefaultControls();
    runtimeWindow.EJS_defaultOptions = this.netplayProfile ? {
      ...this.netplayProfile.defaultCoreOptions,
      ...(this.implementation.runtimeCore === "fbneo" ? {"fbneo-hiscores": "disabled"} : {}),
    } : {...this.implementation.defaultOptions};
    runtimeWindow.EJS_shaders = retromShaders;
    runtimeWindow.EJS_paths = {[fileName(this.implementation.coreAssetPath)]:
      `${this.envelope.runtime.runtimeBaseUrl}${this.implementation.coreAssetPath}`};
    runtimeWindow.EJS_externalFiles = externalFiles(this.envelope);
    runtimeWindow.EJS_ready = () => {
      this.instance = runtimeWindow.EJS_emulator ?? null;
      if (!this.instance) {this.fail("PLAYER_RUNTIME_UNAVAILABLE");}
      this.instance?.on?.("exit", () => this.requestExit());
      const discs = optionalResource(this.envelope, "discs", "MULTI_DISC_V1");
      if (discs && this.instance) {
        try {initializeEmulatorJsDiscs(this.instance);}
        catch (error) {this.fail("PLAYER_DISC_RUNTIME_INVALID", error); return;}
      }
      if (deferredDOSStart && this.instance) {
        const excluded = this.instance.downloadType?.rom?.dontExtractIfCore;
        if (!Array.isArray(excluded)) {this.fail("PLAYER_DOS_ARCHIVE_MODE_UNAVAILABLE"); return;}
        if (!excluded.includes(this.implementation.runtimeCore)) {excluded.push(this.implementation.runtimeCore);}
        try {
          this.dosboxCompatibility?.prepare(this.instance);
          this.cleanupDeferredStart = startWhenAvailable(runtimeWindow);
        } catch (error) {
          this.fail("PLAYER_DOS_STATE_COMPATIBILITY_UNAVAILABLE", error);
        }
      }
      if (this.instance) {this.updateCheckpointAvailability(this.currentCheckpointAvailability());}
    };
    runtimeWindow.EJS_onGameStart = () => {
      void this.completeStart(runtimeWindow);
    };
  }

  private async completeStart(runtimeWindow: Window) {
    if (this.startObserved || this.state !== "MOUNTING") {return;}
    this.startObserved = true;
    try {
      if (!this.instance) {throw new Error("PLAYER_RUNTIME_UNAVAILABLE");}
      const discs = optionalResource(this.envelope, "discs", "MULTI_DISC_V1");
      if (discs) {await this.prepareInitialDisc(discs);}
      else if (this.restorePayload) {await this.restore(this.restorePayload);}
      this.scheduleStartupActions(runtimeWindow);
      this.startBarrier?.resolve();
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("PLAYER_")
        ? error.message
        : "PLAYER_STATE_RESTORE_FAILED";
      this.fail(code, error);
    }
  }

  private scheduleStartupActions(runtimeWindow: Window) {
    const simulate = (this.instance?.gameManager as EjsManager & {
      simulateInput?: (player: number, control: number, value: number) => void;
    } | undefined)?.simulateInput;
    if (!this.implementation.startupActions.length) {return;}
    if (!simulate) {throw new Error("PLAYER_STARTUP_ACTION_UNAVAILABLE");}
    for (const action of this.implementation.startupActions) {
      const pressTimer = runtimeWindow.setTimeout(() => {
        this.startupTimers.delete(pressTimer);
        simulate(action.player, action.control, 1);
        const releaseTimer = runtimeWindow.setTimeout(() => {
          this.startupTimers.delete(releaseTimer);
          simulate(action.player, action.control, 0);
        }, action.durationMs);
        this.startupTimers.add(releaseTimer);
      }, action.delayMs);
      this.startupTimers.add(pressTimer);
    }
  }

  private async restore(bytes: Uint8Array) {
    const manager = this.instance?.gameManager;
    if (manager?.loadExplicitStateAndWait) {await manager.loadExplicitStateAndWait(bytes);}
    else if (manager?.loadStateAndWait) {await manager.loadStateAndWait(bytes);}
    else if (manager?.loadState) {manager.loadState(bytes);}
    else {throw new Error("PLAYER_STATE_RESTORE_FAILED");}
    this.restorePayload = null;
  }

  private async prepareInitialDisc(resourceValue: RuntimeMultiDiscResourceV1) {
    const instance = this.instance;
    if (!instance) {throw new Error("PLAYER_RUNTIME_UNAVAILABLE");}
    const manager = instance.gameManager;
    if (!manager?.toggleMainLoop) {throw new Error("PLAYER_DISC_RUNTIME_INVALID");}
    manager.toggleMainLoop(false);
    switchEmulatorJsDisc(instance, resourceValue, resourceValue.initialDiscIndex);
    if (this.restorePayload) {await this.restore(this.restorePayload);}
    manager.toggleMainLoop(true);
    instance.paused = false;
  }

  private requireDiscResource() {
    const resourceValue = optionalResource(this.envelope, "discs", "MULTI_DISC_V1");
    if (!resourceValue) {throw contractError();}
    return resourceValue;
  }

  private async performExit() {
    const preserveFailure = this.state === "FAILED";
    if (this.state === "MOUNTING") {this.startBarrier?.reject(contractError());}
    this.clearStartBarrier();
    this.host.signal.removeEventListener("abort", this.hostAbort);
    if (this.runtimeWindow) {
      for (const timer of this.startupTimers) {this.runtimeWindow.clearTimeout(timer);}
    }
    this.startupTimers.clear();
    this.loader?.remove();
    this.loader = null;
    this.cleanupStateRestore?.();
    this.cleanupStateRestore = null;
    this.cleanupDeferredStart?.();
    this.cleanupDeferredStart = null;
    this.dosboxCompatibility?.cleanup();
    this.dosboxCompatibility = null;
    this.cleanupExternalFiles?.();
    this.cleanupExternalFiles = null;
    await this.netplayPort?.close();
    this.netplayPort = null;
    this.cleanupNetplayCompatibility?.();
    this.cleanupNetplayCompatibility = null;
    this.cleanupInputFilter?.();
    this.cleanupInputFilter = null;
    this.inputFilter = null;
    this.cleanupArchiveWorker?.();
    this.cleanupArchiveWorker = null;
    if (this.runtimeWindow) {
      for (const name of configuredGlobals) {Reflect.deleteProperty(this.runtimeWindow, name);}
    }
    this.instance = null;
    this.runtimeWindow = null;
    if (!preserveFailure) {this.transition("EXITED");}
    this.listeners.clear();
  }

  private requireInstance() {
    if (!this.instance || this.state === "CREATED" || this.state === "MOUNTING" ||
      this.state === "FAILED" || this.state === "EXITED") {throw contractError();}
    return this.instance;
  }

  private fail(code: string, error?: unknown) {
    if (this.state === "FAILED" || this.state === "EXITED") {return;}
    this.transition("FAILED");
    this.updateCheckpointAvailability({available: false, reason: "FAILED"});
    this.host.reportDiagnostic({code, message: error instanceof Error ? error.message : code});
    this.emit({type: "FATAL_ERROR", code});
    this.startBarrier?.reject(new PlayerRuntimeError(code, {cause: error}));
  }

  private clearStartBarrier() {
    if (this.startTimeout !== null && this.runtimeWindow) {this.runtimeWindow.clearTimeout(this.startTimeout);}
    this.startTimeout = null;
    this.startBarrier = null;
  }

  private transition(next: RuntimeStateV1) {
    if (next === this.state) {return;}
    const previous = this.state;
    this.state = next;
    this.emit({type: "STATE_CHANGED", previous, state: next});
  }

  private currentCheckpointAvailability() {
    if (!this.envelope.runtime.capabilities.checkpoint) {return {available: false, reason: "UNSUPPORTED"};}
    if (!this.instance?.gameManager || this.envelope.runtime.targetId === "dosbox-pure" &&
      this.envelope.targetOptions.kind === "EMULATORJS_V1" && !this.envelope.targetOptions.dosEntryPath) {
      return {available: false, reason: "NOT_READY"};
    }
    return {available: true, reason: null};
  }

  private updateCheckpointAvailability(availability: {available: boolean; reason: string | null}) {
    if (availability.available === this.checkpointAvailability.available &&
      availability.reason === this.checkpointAvailability.reason) {return;}
    this.checkpointAvailability = availability;
    this.emit({type: "CHECKPOINT_AVAILABILITY_CHANGED", availability});
  }

  private requestExit() {
    if (this.exitRequestedEmitted || this.state === "FAILED" || this.state === "EXITED") {return;}
    this.exitRequestedEmitted = true;
    this.emit({type: "EXIT_REQUESTED"});
  }

  private emit(event: RuntimeEventV1) {for (const listener of this.listeners) {listener(event);}}
}

function validInputFilterPolicy(value: RuntimeInputFilterPolicyV1 | null) {
  return value === null || typeof value.suppressInput === "boolean" &&
    (value.activeGamepadIndex === null || Number.isSafeInteger(value.activeGamepadIndex) &&
      value.activeGamepadIndex >= 0 && value.activeGamepadIndex <= 255);
}
function invalid(): never {throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");}
function contractError(cause?: unknown) {return new PlayerRuntimeError("PLAYER_RUNTIME_CONTRACT_INVALID", {cause});}
function capabilityError() {return new PlayerRuntimeError("PLAYER_RUNTIME_CAPABILITY_UNSUPPORTED");}
