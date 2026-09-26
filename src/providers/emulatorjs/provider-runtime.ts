import {ProviderContentOwner} from "../../provider/content-owner.js";
import type {ContentSessionClient} from "../../content-io/client.js";
import {ContentIOError} from "../../content-io/errors.js";
import {stopNativeInstance} from "./native-exit.js";
import {startEmulatorInputDiagnostics} from "./input-diagnostics.js";
import type {RuntimeInputDiagnosticsV1} from "../../provider/module-api.js";
import type {
  AssetIndexV1, LaunchEnvelopeV1, PlayerRuntimeV1, RuntimeDiscStateV1, RuntimeCheckpointAvailabilityV1,
  RuntimeCheckpointV1, RuntimeEventV1, RuntimeHostV1, RuntimeInputFilterPolicyV1,
  RuntimeMultiDiscResourceV1, RuntimeStateV1, RuntimeVideoModeV1,
} from "../../provider/module-api.js";
import {PlayerRuntimeError} from "../../provider/errors.js";
import {focusRuntimeInput} from "../../provider/input-focus.js";
import {emulatorJsProviderDefinition, type EmulatorImplementation} from "./catalog.js";
import {installAsyncRangeStartup} from "./async-range-startup.js";
import {registerSeekableContentFS, type VirtualContentFile} from "./virtual-content-fs.js";
import {configureContentDisc, emulatorJsDisableCue, hasSeekableGame} from "./disc-mount.js";
import {daphneGameFile, daphneVideo, maybeInstallDaphneProject, maybePrepareDaphneProject, type DaphneProject} from "./daphne-project.js";
import {installArchiveWorkerCompatibility} from "./archive-worker.js";
import {installDOSBoxPureStateCompatibility} from "./dosbox-state.js";
import {installExternalFileCompatibility} from "./external-files.js";
import {RuntimeGamepadFilter, installRuntimeGamepadFilter, validInputFilterPolicy} from "../../provider/gamepad-filter.js";
import {initializeEmulatorJsDiscs, readEmulatorJsDiscState, switchEmulatorJsDisc} from "./discs.js";
import {captureEmulatorJsScreenshot} from "./screenshot.js";
import {configureDeferredStart, createStartBarrier, emulatorCheckpointAvailability, needsVerboseRestore, runtimeStartTimeout, type StartBarrier} from "./lifecycle.js";
import {installEmulatorJsRetroArchConfig} from "./retroarch-config.js";
import {installEmulatorJs423StateRestoreCompatibility} from "./state-restore.js";
import {installSupermodelState} from "./supermodel-state.js";
import {installSupermodelRestore} from "./supermodel-restore.js";
import {createRetromDefaultControls, emulatorControlScheme, thomsonMachineOption} from "./default-controls.js";
import {initializeEmulatorJsGamepads} from "./startup-gamepads.js";
import {closeEmulatorJsNativeSettings, openEmulatorJsNativeSettings} from "./native-settings.js";
import {retromShaders} from "./shaders.js";
import {createEmulatorJsVideoModeController} from "./video-mode.js";
import {biosFile, externalFiles, fileName, optionalResource, resource, runtimeBase} from "./resources.js";
import {readEmulatorJsCheckpoint} from "./bytes.js";
import {readPspCheckpoint, restorePspCheckpoint} from "./psp-state.js";
import {installPspRestoreObserver} from "./psp-restore.js";
import {createEmulatorJsMountPoint} from "./frame-style.js";
import {decodeStoredCheckpoint, encodeStoredCheckpoint} from "../../provider/checkpoint-storage.js";
import {installEmulatorJsOutputViewport} from "./output-viewport.js";
import {acknowledgeLutroStoredSave, installLutroNativeRestore, LutroNativeSaveTracker} from "./lutro-native-save.js";

import {configuredGlobals, type EjsInstance, type EjsWindow} from "./emulator-instance.js";

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
  private inputDiagnostics: RuntimeInputDiagnosticsV1 | null = null;
  private runtimeWindow: EjsWindow | null = null;
  private instance: EjsInstance | null = null;
  private loader: HTMLScriptElement | null = null;
  private restorePayload: Uint8Array | null = null;
  private mountPromise: Promise<void> | null = null;
  private exitPromise: Promise<void> | null = null;
  private pspRestore: ReturnType<typeof installPspRestoreObserver> | null = null;
  private cleanupArchiveWorker: (() => void) | null = null;
  private discRange: VirtualContentFile | null = null;
  private daphneProject: DaphneProject | null = null;
  private cleanupDaphneProject: (() => void) | null = null;
  private cleanupFlycast: (() => void) | null = null;
  private cleanupSeekableFS: (() => void) | null = null;
  private cleanupFrameStyle: (() => void) | null = null;
  private outputViewport: ReturnType<typeof installEmulatorJsOutputViewport> | null = null;
  private videoModeController: ReturnType<typeof createEmulatorJsVideoModeController> | null = null;
  private cleanupStateRestore: (() => void) | null = null;
  private cleanupSupermodelState: (() => void) | null = null;
  private supermodelRestore: ReturnType<typeof installSupermodelRestore> | null = null;
  private cleanupExternalFiles: (() => void) | null = null;
  private cleanupInputFilter: (() => void) | null = null;
  private cleanupGamepadIndex: (() => void) | null = null;
  private inputFilter: RuntimeGamepadFilter | null = null;
  private cleanupRetroArchConfig: () => void = () => undefined;
  private dosboxCompatibility: ReturnType<typeof installDOSBoxPureStateCompatibility> | null = null;
  private cleanupDeferredStart: (() => void) | null = null;
  private lutroNativeSave: LutroNativeSaveTracker | null = null;
  private startBarrier: StartBarrier | null = null;
  private startTimeout: number | null = null;
  private readonly startupTimers = new Set<number>();
  private startObserved = false;
  private exitRequestedEmitted = false;
  private checkpointAvailability: RuntimeCheckpointAvailabilityV1 = {available: false, reason: "NOT_READY"};
  private readonly implementation: EmulatorImplementation;
  private readonly eagerContentGame: boolean;
  private readonly contentOwner = new ProviderContentOwner(error => this.fail(error.message, error), diagnostic => this.host.reportDiagnostic({code: "CONTENT_IO_METRICS", message: JSON.stringify(diagnostic)}));
  private contentSession: ContentSessionClient | null = null;
  private readonly hostAbort = () => {this.contentOwner.force(); void this.exit();};

  constructor(
    private readonly envelope: LaunchEnvelopeV1,
    private readonly host: RuntimeHostV1,
    private readonly assetIndex: AssetIndexV1,
  ) {
    const target = emulatorJsProviderDefinition.targets.find((entry) => entry.id === envelope.runtime.targetId);
    if (!target) {invalid();}
    this.implementation = target.implementation;
    this.eagerContentGame = target.contentIO.game.mode === "EAGER";
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
    if (!this.envelope.runtime.capabilities.pause) {throw capabilityError();}
    if (this.state === "PAUSED") {return;}
    if (this.state !== "RUNNING") {throw contractError();}
    const instance = this.requireInstance();
    const toggle = instance.gameManager?.toggleMainLoop;
    if (!toggle) {throw contractError();}
    if (this.discRange) {await this.discRange.idle();}
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
    focusRuntimeInput(this.getCanvas(), this.runtimeWindow);
    this.transition("RUNNING");
  }

  async checkpoint() {
    if (!this.envelope.runtime.capabilities.checkpoint) {throw capabilityError();}
    if (this.discRange) {await this.discRange.idle();}
    const manager = this.requireInstance().gameManager;
    const maximum = this.envelope.runtime.checkpoint?.maxBytes ?? 0;
    const bytes = this.implementation.runtimeCore === "ppsspp"
      ? await readPspCheckpoint(manager, maximum, this.state === "PAUSED")
      : this.implementation.runtimeCore === "lutro"
        ? await this.lutroNativeSave?.capture()
      : await readEmulatorJsCheckpoint(manager, this.state === "PAUSED");
    if (!bytes || bytes.byteLength < 1 || bytes.byteLength > maximum) {
      throw contractError();
    }
    const format = this.envelope.runtime.checkpoint!.writeFormat;
    return {bytes: await encodeStoredCheckpoint(bytes, format, maximum, this.host.signal), format, metadata: null};
  }

  async acknowledgeCheckpoint(checkpoint: RuntimeCheckpointV1) {
    if (this.implementation.runtimeCore !== "lutro" || !this.lutroNativeSave) {throw capabilityError();}
    await acknowledgeLutroStoredSave(this.lutroNativeSave, checkpoint, this.envelope.runtime.checkpoint, this.host.signal);
  }

  async screenshot() {
    if (this.discRange) {await this.discRange.idle();}
    return captureEmulatorJsScreenshot(this.requireInstance());
  }

  exit() {
    this.exitPromise ??= Promise.resolve().then(() => this.performExit());
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
    if (this.implementation.runtimeCore === "daphne") {
      const canvas = this.requireInstance().canvas;
      if (!canvas || (mode !== "original" && mode !== "pixel")) {throw contractError();}
      canvas.style.setProperty("image-rendering", mode === "pixel" ? "pixelated" : "auto", "important");
      this.outputViewport?.setVideoMode(mode);
      return;
    }
    this.videoModeController ??= createEmulatorJsVideoModeController(this.requireInstance(), this.runtimeWindow!);
    if (!this.videoModeController.setVideoMode(mode)) {throw contractError();}
    this.outputViewport?.setVideoMode(mode);
  }
  async openNativeSettings(panel: "controls" | "display" | "core") {
    if (!this.envelope.runtime.capabilities.nativeSettings) {throw capabilityError();}
    if (!openEmulatorJsNativeSettings(this.requireInstance(), panel, this.state === "PAUSED")) {throw contractError();}
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
    if (this.state === "FAILED" || this.state === "EXITED" || !validInputFilterPolicy(policy)) {
      throw contractError();
    }
    if (policy === null) {
      this.stopInputDiagnostics();
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
    return this.inputDiagnostics = startEmulatorInputDiagnostics(this.runtimeWindow, this.instance, () => this.getCanvas());
  }

  subscribe(listener: (event: RuntimeEventV1) => void) {this.listeners.add(listener); return () => this.listeners.delete(listener);}

  private prepareRetroArchConfig(runtimeWindow: Window) {
    this.cleanupRetroArchConfig = installEmulatorJsRetroArchConfig(runtimeWindow,
      this.implementation.runtimeCore, Boolean(this.restorePayload) && this.implementation.release === "4.2.3");
  }

  private installPreloaderCompatibility(runtimeWindow: EjsWindow) {
    this.prepareRetroArchConfig(runtimeWindow);
    this.cleanupArchiveWorker = installArchiveWorkerCompatibility(runtimeWindow, this.implementation.release,
      runtimeBase(this.envelope, this.implementation.release), this.implementation.runtimeCore);
    if (this.implementation.release === "4.2.3" && Object.keys(externalFiles(this.envelope)).length) {
      this.cleanupExternalFiles = installExternalFileCompatibility(runtimeWindow);
    }
    if (this.restorePayload && this.implementation.release === "4.2.3") {
      this.cleanupStateRestore = installEmulatorJs423StateRestoreCompatibility(runtimeWindow,
        this.implementation.runtimeCore === "mame2003_plus");
    }
    if (this.restorePayload && this.implementation.runtimeCore === "supermodel") {
      this.supermodelRestore = installSupermodelRestore(runtimeWindow);
      this.cleanupStateRestore = this.supermodelRestore.cleanup;
    }
    if (this.implementation.release === "4.3.0-pre" && this.implementation.runtimeCore === "dosbox_pure") {
      this.dosboxCompatibility = installDOSBoxPureStateCompatibility(runtimeWindow);
    }
    if (this.inputFilter) {this.cleanupInputFilter = installRuntimeGamepadFilter(runtimeWindow, this.inputFilter);}
  }

  private async performMount(target: HTMLElement) {
    this.transition("MOUNTING");
    this.host.signal.addEventListener("abort", this.hostAbort, {once: true});
    try {
      this.checkMountActive();
      this.restorePayload = await this.host.loadRestore(this.envelope.restore);
      if (this.restorePayload && this.envelope.restore) {
        this.restorePayload = await decodeStoredCheckpoint(this.restorePayload, this.envelope.restore.format,
          this.envelope.runtime.checkpoint?.maxBytes ?? 0, this.host.signal);
      }
      const frame = await this.host.mountFrame(target, {resourceRole: null});
      if (this.implementation.outputSizeLimit) {
        this.outputViewport = installEmulatorJsOutputViewport(frame.element, target, this.implementation.outputSizeLimit);
      }
      const runtimeWindow = frame.contentWindow as EjsWindow;
      this.runtimeWindow = runtimeWindow;
      this.checkMountActive();
      const declaration = emulatorJsProviderDefinition.targets.find(entry => entry.id === this.envelope.runtime.targetId)!;
      this.contentSession = await this.contentOwner.start(declaration, this.envelope, this.assetIndex);
      this.checkMountActive();
      this.daphneProject = await maybePrepareDaphneProject(this.implementation.runtimeCore, this.envelope,
        this.contentSession, this.host.signal, error => this.fail(error.message, error),
        (loadedBytes, totalBytes) => this.emit({type: "LOAD_PROGRESS", loadedBytes, totalBytes}));
      this.discRange = daphneVideo(this.daphneProject);
      this.checkMountActive();
      this.cleanupFrameStyle = createEmulatorJsMountPoint(runtimeWindow);
      this.startBarrier = createStartBarrier();
      this.configure(runtimeWindow);
      const disc = await configureContentDisc(runtimeWindow, this.envelope, this.implementation.runtimeCore, this.host.signal,
        this.contentSession, error => this.fail(error.message, error), this.eagerContentGame,
        (loadedBytes, totalBytes) => this.emit({type: "LOAD_PROGRESS", loadedBytes, totalBytes}));
      if (disc.range) {this.discRange = disc.range;}
      this.cleanupFlycast = disc.cleanup;
      this.checkMountActive();

      this.installPreloaderCompatibility(runtimeWindow);
      const loader = runtimeWindow.document.createElement("script");
      loader.async = true;
      loader.dataset.retromLoader = "true";
      loader.src = `${runtimeBase(this.envelope, this.implementation.release)}loader.js`;
      runtimeWindow.document.head.append(loader);
      this.loader = loader;
      loader.addEventListener("error", () => this.fail("PLAYER_RUNTIME_LOADER_FAILED"), {once: true});
      const startTimeoutMs = runtimeStartTimeout(this.implementation.runtimeCore, this.restorePayload !== null);
      this.startTimeout = runtimeWindow.setTimeout(() => this.fail("PLAYER_RUNTIME_START_TIMEOUT"), startTimeoutMs);
      await this.startBarrier.promise;
      this.checkMountActive();
      this.clearStartBarrier();
      this.transition("RUNNING");
    } catch (error) {
      if (this.state !== "FAILED" && this.state !== "EXITED") {this.transition("FAILED");}
      this.contentOwner.force();
      await this.exit();
      throw error;
    }
  }

  private configure(runtimeWindow: EjsWindow) {
    if (this.implementation.runtimeCore === "ppsspp") {this.pspRestore = installPspRestoreObserver(runtimeWindow);}
    const seekable = hasSeekableGame(this.envelope);
    const gameURL = this.daphneProject ? `/roms/${this.daphneProject.romName}` :
      resource(this.envelope, "game", seekable ? "SEEKABLE_BLOB" : "ROM_BLOB").url;
    const bios = optionalResource(this.envelope, "bios", "BIOS_BUNDLE");
    const parent = optionalResource(this.envelope, "parent", "PARENT_ARCHIVE");
    const releaseBase = runtimeBase(this.envelope, this.implementation.release);
    const deferredDOSStart = this.implementation.release === "4.3.0-pre" &&
      this.implementation.runtimeCore === "dosbox_pure";
    const deferredArchiveStart = this.implementation.release === "4.3.0-pre" &&
      this.implementation.runtimeCore === "supermodel";
    const deferredStart = deferredDOSStart || deferredArchiveStart;
    runtimeWindow.EJS_player = "#retrom-emulator";
    runtimeWindow.EJS_core = this.implementation.runtimeCore;
    runtimeWindow.EJS_controlScheme = emulatorControlScheme(this.implementation.runtimeCore, this.implementation.release, gameURL);
    runtimeWindow.EJS_gameUrl = daphneGameFile(runtimeWindow, this.daphneProject, gameURL);
    runtimeWindow.EJS_gameName = this.envelope.session.title;
    runtimeWindow.EJS_gameID = 0;
    runtimeWindow.EJS_pathtodata = releaseBase;
    runtimeWindow.EJS_biosUrl = biosFile(bios);
    runtimeWindow.EJS_gameParentUrl = parent?.url;
    runtimeWindow.EJS_startOnLoaded = !deferredStart;
    runtimeWindow.EJS_dontExtractRom = deferredStart || this.implementation.runtimeCore === "flycast" || seekable || this.eagerContentGame || !!this.daphneProject;
    runtimeWindow.EJS_disableBatchBootup = deferredDOSStart;
    runtimeWindow.EJS_disableCue = emulatorJsDisableCue(this.implementation.runtimeCore, this.envelope.runtime.targetId) ? true : undefined;
    runtimeWindow.EJS_language = "zh-CN";
    runtimeWindow.EJS_disableAutoLang = false;
    // RetroArch emits native load receipts only in verbose mode. The PSP and
    // Model 3 restore barriers must observe a receipt before admitting gameplay.
    runtimeWindow.EJS_DEBUG_XX = needsVerboseRestore(this.implementation.runtimeCore, this.envelope.restore !== null);
    runtimeWindow.EJS_EXPERIMENTAL_NETPLAY = false;
    runtimeWindow.EJS_threads = this.implementation.artifactFlavor === "THREAD_WASM";
    runtimeWindow.EJS_fullscreenOnLoaded = false;
    runtimeWindow.EJS_disableDatabases = true;
    runtimeWindow.EJS_disableLocalStorage = true;
    runtimeWindow.EJS_CacheLimit = 0;
    runtimeWindow.EJS_Buttons = {exitEmulation: false};
    runtimeWindow.EJS_defaultControls = createRetromDefaultControls(this.implementation.runtimeCore);
    runtimeWindow.EJS_defaultOptions = {...this.implementation.defaultOptions, ...thomsonMachineOption(this.implementation.runtimeCore, this.envelope.session.title),
      ...(this.implementation.runtimeCore === "daphne" ? {shader: "disabled"} : {}),
      ...(this.implementation.runtimeCore === "cap32" && new URL(gameURL, "http://runtime.invalid").pathname.toLowerCase().endsWith(".cpr")
        ? {cap32_model: "6128+ (experimental)", cap32_gfx_colors: "24bit"} : {}),
    };
    runtimeWindow.EJS_shaders = retromShaders;
    runtimeWindow.EJS_paths = {[fileName(this.implementation.coreAssetPath)]:
      `${this.envelope.runtime.runtimeBaseUrl}${this.implementation.coreAssetPath}`};
    runtimeWindow.EJS_externalFiles = externalFiles(this.envelope);
    const checkpointMaximum = this.envelope.runtime.checkpoint?.maxBytes ?? 0;
    runtimeWindow.EJS_ready = () => {
      this.instance = runtimeWindow.EJS_emulator ?? null;
      if (!this.instance) {this.fail("PLAYER_RUNTIME_UNAVAILABLE"); return;}
      const instance = this.instance;
      this.cleanupGamepadIndex = initializeEmulatorJsGamepads(instance);
      if (["neocd", "flycast", "daphne"].includes(this.implementation.runtimeCore) && this.discRange) {installAsyncRangeStartup(instance, this.discRange);}
      if ((seekable || this.eagerContentGame || this.daphneProject) && !["neocd", "flycast"].includes(this.implementation.runtimeCore) && this.discRange) {
        try {this.cleanupSeekableFS = registerSeekableContentFS(instance, this.discRange,
          error => this.fail("EMULATORJS_CONTENT_FS_UNAVAILABLE", error), this.implementation.runtimeCore === "daphne");}
        catch (error) {this.fail("EMULATORJS_CONTENT_FS_UNAVAILABLE", error); return;}
      }
      this.cleanupDaphneProject = maybeInstallDaphneProject(instance, this.daphneProject,
        error => this.fail("DAPHNE_MOUNT_FAILED", error));
      installLutroNativeRestore(this.implementation.runtimeCore, instance, this.restorePayload,
        checkpointMaximum, () => {this.restorePayload = null;},
        error => this.fail("PLAYER_STATE_RESTORE_FAILED", error));
      instance.on?.("exit", () => this.requestExit());
      const discs = optionalResource(this.envelope, "discs", "MULTI_DISC");
      if (discs) {
        try {initializeEmulatorJsDiscs(instance);}
        catch (error) {this.fail("PLAYER_DISC_RUNTIME_INVALID", error); return;}
      }
      if (deferredStart) {
        try {
          this.cleanupDeferredStart = configureDeferredStart(runtimeWindow, instance, this.implementation.runtimeCore);
        } catch (error) {
          this.fail(error instanceof Error && error.message === "PLAYER_ROM_ARCHIVE_MODE_UNAVAILABLE"
            ? error.message : "PLAYER_ROM_START_UNAVAILABLE", error);
        }
      }
      this.updateCheckpointAvailability(this.currentCheckpointAvailability());
    };
    runtimeWindow.EJS_onGameStart = () => {
      if (this.implementation.runtimeCore === "lutro" && this.instance && !this.lutroNativeSave) {
        this.lutroNativeSave = new LutroNativeSaveTracker(this.instance, checkpointMaximum,
          Boolean(this.envelope.restore), value => this.updateCheckpointAvailability(value));
        this.lutroNativeSave.start();
      }
      if (this.implementation.runtimeCore === "supermodel" && !this.cleanupSupermodelState) {
        try {
          const manager = this.instance?.gameManager;
          if (!manager) {throw new Error("PLAYER_STATE_COMPATIBILITY_UNAVAILABLE");}
          const cleanupState = installSupermodelState(manager);
          try {
            const cleanupRestore = this.supermodelRestore?.attach(manager);
            this.cleanupSupermodelState = () => {cleanupRestore?.(); cleanupState();};
          } catch (error) {cleanupState(); throw error;}
        } catch (error) {this.fail("PLAYER_STATE_COMPATIBILITY_UNAVAILABLE", error); return;}
      }
      void this.completeStart(runtimeWindow);
    };
  }

  private async completeStart(runtimeWindow: Window) {
    if (this.startObserved || this.state !== "MOUNTING") {return;}
    this.startObserved = true;
    try {
      if (!this.instance) {throw new Error("PLAYER_RUNTIME_UNAVAILABLE");}
      this.dosboxCompatibility?.prepare(this.instance);
      const discs = optionalResource(this.envelope, "discs", "MULTI_DISC");
      if (discs) {await this.prepareInitialDisc(discs);}
      else if (this.restorePayload) {
        await this.restore(this.restorePayload);
        if (!this.instance.gameManager?.toggleMainLoop) {throw new Error("PLAYER_STATE_RESTORE_FAILED");}
        this.instance.gameManager.toggleMainLoop(true);
        this.instance.paused = false;
      }
      if (this.implementation.runtimeCore !== "ppsspp" || !this.envelope.restore) {this.scheduleStartupActions(runtimeWindow);}
      this.updateCheckpointAvailability(this.currentCheckpointAvailability());
      this.startBarrier?.resolve();
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("PLAYER_")
        ? error.message
        : "PLAYER_STATE_RESTORE_FAILED";
      this.fail(code, error);
    }
  }

  private scheduleStartupActions(runtimeWindow: Window) {
    if (!this.implementation.startupActions.length) {return;}
    const manager = this.instance?.gameManager;
    const simulate = manager?.simulateInput?.bind(manager);
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
    if (this.discRange) {await this.discRange.idle();}
    const manager = this.instance?.gameManager;
    if (this.implementation.runtimeCore === "ppsspp") {
      await restorePspCheckpoint(manager, bytes, this.envelope.runtime.checkpoint?.maxBytes ?? 0,
        () => this.pspRestore!.wait(this.host.signal), this.host.signal);
    } else if (manager?.loadExplicitStateAndWait) {await manager.loadExplicitStateAndWait(bytes);}
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
    const resourceValue = optionalResource(this.envelope, "discs", "MULTI_DISC");
    if (!resourceValue) {throw contractError();}
    return resourceValue;
  }

  private checkMountActive() {
    if (this.host.signal.aborted || this.exitPromise || this.state !== "MOUNTING") {throw new DOMException("Aborted", "AbortError");}
  }

  private async performExit() {
    const preserveFailure = this.state === "FAILED";
    if (this.state === "MOUNTING") {this.startBarrier?.reject(contractError());}
    this.clearStartBarrier();
    this.host.signal.removeEventListener("abort", this.hostAbort);
    const nativeExitAlreadyRequested = this.exitRequestedEmitted; this.exitRequestedEmitted = true;
    await stopNativeInstance(this.runtimeWindow, this.instance, this.implementation.runtimeCore, nativeExitAlreadyRequested, this.discRange);
    await this.closeContent();
    if (this.runtimeWindow) {
      for (const timer of this.startupTimers) {this.runtimeWindow.clearTimeout(timer);}
    }
    this.startupTimers.clear();
    this.loader?.remove();
    this.loader = null;
    this.cleanupSurface();
    this.cleanupStateRestore?.();
    this.cleanupStateRestore = null;
    this.supermodelRestore = null;
    this.cleanupSupermodelState?.();
    this.cleanupSupermodelState = null;
    this.cleanupDeferredStart?.();
    this.cleanupDeferredStart = null;
    this.dosboxCompatibility?.cleanup();
    this.dosboxCompatibility = null;
    this.cleanupExternalFiles?.();
    this.cleanupExternalFiles = null;
    this.stopInputDiagnostics();
    this.cleanupRetroArchConfig();
    this.cleanupRetroArchConfig = () => undefined;
    this.cleanupInputFilter?.(); this.cleanupInputFilter = null;
    this.cleanupGamepadIndex?.(); this.cleanupGamepadIndex = null;
    this.inputFilter = null;
    this.pspRestore?.cleanup(); this.pspRestore = null;
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

  private async closeContent() {
    await this.contentOwner.close(); this.contentSession = null;
    await this.discRange?.dispose(); this.discRange = null;
    this.daphneProject = null;
  }

  private requireInstance() {
    if (!this.instance || this.state === "CREATED" || this.state === "MOUNTING" ||
      this.state === "FAILED" || this.state === "EXITED") {throw contractError();}
    return this.instance;
  }

  private stopInputDiagnostics() {
    this.inputDiagnostics?.stop();
    this.inputDiagnostics = null;
  }

  private cleanupSurface() {
    this.cleanupDaphneProject?.(); this.cleanupDaphneProject = null;
    this.lutroNativeSave?.stop(); this.lutroNativeSave = null;
    this.cleanupSeekableFS?.(); this.cleanupSeekableFS = null;
    this.videoModeController?.cleanup();
    this.videoModeController = null;
    this.cleanupFlycast?.(); this.cleanupFlycast = null;
    this.cleanupFrameStyle?.();
    this.cleanupFrameStyle = null;
    this.outputViewport?.cleanup();
    this.outputViewport = null;
  }

  private fail(code: string, error?: unknown) {
    if (this.state === "FAILED" || this.state === "EXITED") {return;}
    this.transition("FAILED");
    this.lutroNativeSave?.stop();
    this.contentOwner.force(error instanceof ContentIOError ? error : new ContentIOError("INTERNAL"));
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

  private currentCheckpointAvailability() {return emulatorCheckpointAvailability(this.envelope, this.instance, this.implementation.runtimeCore, this.lutroNativeSave);}

  private updateCheckpointAvailability(availability: RuntimeCheckpointAvailabilityV1) {
    if (JSON.stringify(availability) === JSON.stringify(this.checkpointAvailability)) {return;}
    this.checkpointAvailability = availability; this.emit({type: "CHECKPOINT_AVAILABILITY_CHANGED", availability});
  }

  private requestExit() {
    if (this.exitRequestedEmitted || this.state === "FAILED" || this.state === "EXITED") {return;}
    this.exitRequestedEmitted = true; this.emit({type: "EXIT_REQUESTED"});
  }

  private emit(event: RuntimeEventV1) {for (const listener of this.listeners) {listener(event);}}
}

function invalid(): never {throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");}
function contractError(cause?: unknown) {return new PlayerRuntimeError("PLAYER_RUNTIME_CONTRACT_INVALID", {cause});}
function capabilityError() {return new PlayerRuntimeError("PLAYER_RUNTIME_CAPABILITY_UNSUPPORTED");}
