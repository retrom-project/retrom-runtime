import type {
  AssetIndexV1,
  LaunchEnvelopeV1,
  PlayerRuntimeV1,
  RuntimeDiscStateV1,
  RuntimeEventV1,
  RuntimeHostV1,
  RuntimeInputFilterPolicyV1,
  RuntimeNetplayPortV1,
  RuntimeResourceV1,
  RuntimeStateV1,
  RuntimeValidationResultV1,
  RuntimeVideoModeV1,
} from "../../provider/module-api.js";
import {emulatorJsProviderDefinition} from "./catalog.js";
import {installArchiveWorkerCompatibility} from "./archive-worker.js";
import {installDOSBoxPureStateCompatibility} from "./dosbox-state.js";
import {installExternalFileCompatibility} from "./external-files.js";
import {captureEmulatorJsScreenshot} from "./screenshot.js";
import {installEmulatorJs423StateRestoreCompatibility} from "./state-restore.js";

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

type EjsInstance = {
  canvas?: HTMLCanvasElement;
  capture?: {photo?: {source?: string; format?: string; upscale?: number}};
  gameManager?: EjsManager;
  paused?: boolean;
  setVolume?: (value: number) => void;
  takeScreenshot?: (source: string, format: string, upscale: number) => Promise<{blob: Blob; format: string}>;
  downloadType?: {rom?: {dontExtractIfCore?: string[]}};
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
  EJS_defaultOptions?: Record<string, string>;
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
  "EJS_disableLocalStorage", "EJS_CacheLimit", "EJS_Buttons", "EJS_defaultOptions", "EJS_paths",
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
  private dosboxCompatibility: ReturnType<typeof installDOSBoxPureStateCompatibility> | null = null;
  private cleanupDeferredStart: (() => void) | null = null;
  private readonly implementation: EmulatorImplementation;

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
  }

  mount(target: HTMLElement) {
    if (this.mountPromise || this.state !== "CREATED") {return Promise.reject(contractError());}
    this.mountPromise = this.performMount(target);
    return this.mountPromise;
  }

  async pause() {
    const instance = this.requireInstance();
    const toggle = instance.gameManager?.toggleMainLoop;
    if (!toggle) {throw contractError();}
    toggle.call(instance.gameManager, false);
    instance.paused = true;
    this.transition("PAUSED");
  }

  async resume() {
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
  getCheckpointAvailability() {
    if (!this.instance?.gameManager || this.envelope.runtime.targetId === "dosbox-pure" &&
      this.envelope.targetOptions.kind === "EMULATORJS_V1" && !this.envelope.targetOptions.dosEntryPath) {
      return {available: false, reason: "NOT_READY"};
    }
    return {available: true, reason: null};
  }
  getCanvas() {return this.instance?.canvas ?? null;}
  getFrameCount() {return this.instance?.gameManager?.getFrameNum?.() ?? null;}

  async setVolume(value: number) {
    const instance = this.requireInstance();
    if (!Number.isFinite(value) || value < 0 || value > 1 || !instance.setVolume) {throw contractError();}
    instance.setVolume(value);
  }

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
      this.restorePayload = await this.host.loadRestore(this.envelope.restore);
      const frame = await this.host.mountFrame(target, {resourceRole: null});
      const runtimeWindow = frame.contentWindow as EjsWindow;
      this.runtimeWindow = runtimeWindow;
      this.configure(runtimeWindow);
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
      const loader = runtimeWindow.document.createElement("script");
      loader.async = true;
      loader.dataset.retromLoader = "true";
      loader.src = `${runtimeBase(this.envelope, this.implementation.release)}loader.js`;
      runtimeWindow.document.head.append(loader);
      this.loader = loader;
      this.host.signal.addEventListener("abort", () => {void this.exit();}, {once: true});
      this.transition("RUNNING");
    } catch (error) {
      this.transition("FAILED");
      await this.performExit();
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
    runtimeWindow.EJS_defaultOptions = {...this.implementation.defaultOptions};
    runtimeWindow.EJS_paths = {[fileName(this.implementation.coreAssetPath)]:
      `${this.envelope.runtime.runtimeBaseUrl}${this.implementation.coreAssetPath}`};
    runtimeWindow.EJS_externalFiles = externalFiles(this.envelope);
    runtimeWindow.EJS_ready = () => {
      this.instance = runtimeWindow.EJS_emulator ?? null;
      if (!this.instance) {this.fail("PLAYER_RUNTIME_UNAVAILABLE");}
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
    };
    runtimeWindow.EJS_onGameStart = () => {
      this.scheduleStartupActions(runtimeWindow);
      if (this.restorePayload) {void this.restore(this.restorePayload);}
    };
  }

  private scheduleStartupActions(runtimeWindow: Window) {
    const simulate = (this.instance?.gameManager as EjsManager & {
      simulateInput?: (player: number, control: number, value: number) => void;
    } | undefined)?.simulateInput;
    if (!this.implementation.startupActions.length) {return;}
    if (!simulate) {this.fail("PLAYER_STARTUP_ACTION_UNAVAILABLE"); return;}
    for (const action of this.implementation.startupActions) {
      runtimeWindow.setTimeout(() => {
        simulate(action.player, action.control, 1);
        runtimeWindow.setTimeout(() => simulate(action.player, action.control, 0), action.durationMs);
      }, action.delayMs);
    }
  }

  private async restore(bytes: Uint8Array) {
    try {
      const manager = this.requireInstance().gameManager;
      if (manager?.loadExplicitStateAndWait) {await manager.loadExplicitStateAndWait(bytes);}
      else if (manager?.loadStateAndWait) {await manager.loadStateAndWait(bytes);}
      else if (manager?.loadState) {manager.loadState(bytes);}
      else {throw contractError();}
      this.restorePayload = null;
    } catch (error) {
      this.fail("PLAYER_STATE_RESTORE_FAILED", error);
    }
  }

  private async performExit() {
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
    this.cleanupArchiveWorker?.();
    this.cleanupArchiveWorker = null;
    if (this.runtimeWindow) {
      for (const name of configuredGlobals) {Reflect.deleteProperty(this.runtimeWindow, name);}
    }
    this.instance = null;
    this.runtimeWindow = null;
    this.transition("EXITED");
    this.listeners.clear();
  }

  private requireInstance() {
    if (!this.instance || this.state === "CREATED" || this.state === "MOUNTING" ||
      this.state === "FAILED" || this.state === "EXITED") {throw contractError();}
    return this.instance;
  }

  private fail(code: string, error?: unknown) {
    this.transition("FAILED");
    this.host.reportDiagnostic({code, message: error instanceof Error ? error.message : code});
    this.emit({type: "FATAL_ERROR", code});
  }

  private transition(next: RuntimeStateV1) {
    if (next === this.state) {return;}
    const previous = this.state;
    this.state = next;
    this.emit({type: "STATE_CHANGED", previous, state: next});
  }

  private emit(event: RuntimeEventV1) {for (const listener of this.listeners) {listener(event);}}
}

function externalFiles(envelope: LaunchEnvelopeV1) {
  const files = optionalResource(envelope, "external", "EXTERNAL_FILE_SET_V1")?.files ?? [];
  const result: Record<string, string> = {};
  for (const file of files) {result[file.virtualPath] = file.url;}
  const discs = optionalResource(envelope, "discs", "MULTI_DISC_V1");
  for (const entry of discs?.entries ?? []) {
    result[`/disc-${String(entry.index + 1).padStart(3, "0")}.chd`] = entry.url;
  }
  return result;
}

type RuntimeResourceOfKind<Kind extends RuntimeResourceV1["kind"]> = RuntimeResourceV1 & {kind: Kind};

function biosFile(resourceValue: RuntimeResourceOfKind<"BIOS_BUNDLE_V1"> | null) {
  if (!resourceValue) {return undefined;}
  const bundle = resourceValue.files.find((entry) => entry.logicalName === "bundle.zip") ?? resourceValue.files[0];
  if (!bundle) {invalid();}
  return bundle.url;
}

function runtimeBase(envelope: LaunchEnvelopeV1, release: string) {
  return `${envelope.runtime.runtimeBaseUrl}assets/${release}/data/`;
}

function resource<Role extends string, Kind extends RuntimeResourceV1["kind"]>(
  envelope: LaunchEnvelopeV1,
  role: Role,
  kind: Kind,
): RuntimeResourceOfKind<Kind> {
  const value = optionalResource(envelope, role, kind);
  if (!value) {invalid();}
  return value;
}

function optionalResource<Role extends string, Kind extends RuntimeResourceV1["kind"]>(
  envelope: LaunchEnvelopeV1,
  role: Role,
  kind: Kind,
): RuntimeResourceOfKind<Kind> | null {
  const value = envelope.resources.find((entry) => entry.role === role);
  if (!value) {return null;}
  if (value.kind !== kind) {invalid();}
  return value as RuntimeResourceOfKind<Kind>;
}

function fileName(path: string) {return path.slice(path.lastIndexOf("/") + 1);}
function startWhenAvailable(runtimeWindow: Window) {
  const click = () => {
    const button = runtimeWindow.document.querySelector<HTMLElement>(".ejs_start_button");
    button?.click();
    return Boolean(button);
  };
  if (click()) {return () => undefined;}
  const Observer = runtimeWindow.document.defaultView?.MutationObserver;
  if (!Observer) {throw new Error("PLAYER_DOS_START_UNAVAILABLE");}
  let timeout = 0;
  const observer = new Observer(() => {
    if (!click()) {return;}
    observer.disconnect();
    runtimeWindow.clearTimeout(timeout);
  });
  observer.observe(runtimeWindow.document.documentElement, {childList: true, subtree: true});
  timeout = runtimeWindow.setTimeout(() => {
    observer.disconnect();
    runtimeWindow.dispatchEvent(new ErrorEvent("error", {error: new Error("PLAYER_DOS_START_UNAVAILABLE")}));
  }, 30_000);
  return () => {observer.disconnect(); runtimeWindow.clearTimeout(timeout);};
}
function invalid(): never {throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");}
function contractError() {return new Error("PLAYER_RUNTIME_CONTRACT_INVALID");}
function capabilityError() {return new Error("PLAYER_RUNTIME_CAPABILITY_UNSUPPORTED");}
