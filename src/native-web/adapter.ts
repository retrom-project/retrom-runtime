import {completeChannelReply} from "../provider/channel-reply.js";
import {type RpgPluginFile} from "./plugin-files.js";
import {rpgGameSaveFormat} from "../rpgmaker/format.js";
import {inGameSave} from "../rpgmaker/game-saves.js";
import type {CheckpointAvailability, RuntimeCheckpoint} from "../contract.js";
import type {RuntimeHostShortcutV1, RuntimeTouchGamepadV1, RuntimeTouchStickModeV1, RuntimeTouchStickV1} from "../provider/module-api.js";
import {NativeInputDiagnostics} from "./input-diagnostics.js";
import {createNativeGameEditor} from "./editor.js";
import {nativeReadyDeadline, type NativeReadyOptions} from "./startup-timeout.js";
import {
  decodeRpgCheckpoint,
  type RpgCheckpointBundle,
} from "../checkpoint.js";
import type { MountedRuntimeAdapter, RuntimeExitReporter } from "../internal-adapter.js";

import type {NativeRpgParameters} from "./parameters.js";

type Reply = {
  body: Record<string, unknown>;
  launchId: string;
  nonce: string;
  protocolVersion: number;
  requestId: number;
  type: string;
};

type Pending = {
  reject: (reason: Error) => void;
  resolve: (reply: Reply) => void;
  timer: number;
  type?: string;
};

type NativeBootstrapAction = "CONNECT" | "IGNORE";

const protocolVersion = 1;
const maximumControlBytes = 64 * 1024;
const maximumCheckpointBytes = 64 * 1024 * 1024;
const maximumScreenshotBytes = 10 * 1024 * 1024;
const bootstrapTimeoutMs = 10_000;
const cleanupTimeoutMs = 2_000;

export async function mountNativeRpg(
  config: NativeRpgParameters,
  frame: HTMLIFrameElement,
  restorePayload: Uint8Array | null,
  reportExitRequested: RuntimeExitReporter = () => undefined,
  readyOptions: NativeReadyOptions & {touchGamepadEnabled?: boolean; touchStickMode?: RuntimeTouchStickModeV1} = {},
  pluginFiles: RpgPluginFile[] = [],
) {
  const channel = new NativeChannel(config, reportExitRequested, pluginFiles);
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock allow-modals");
  frame.referrerPolicy = "no-referrer";
  let expectedEngine: "RPGMV" | "RPGMZ";
  let touchGamepad: RuntimeTouchGamepadV1 | null = null;
  let touchStick: RuntimeTouchStickV1 | null = null;
  try {
    await bootstrapNativeFrame(config, frame, channel, readyOptions, restorePayload);
    const ready = await channel.ready(readyOptions);
    expectedEngine = config.bridgeProfile;
    if (ready.engine !== expectedEngine || ready.engineProfile !== config.bridgeProfile) {
      throw new Error("RPG_ENGINE_PROFILE_MISMATCH");
    }
    channel.startStatusLoop();
    let enabled = readyOptions.touchGamepadEnabled ?? true;
    const stickMode = readyOptions.touchStickMode ?? "FLOATING";
    touchStick = {getState: () => ({mode: stickMode})};
    const setEnabled = async (value: boolean) => {
      const reply = await channel.request("SET_TOUCH_GAMEPAD", {enabled: value, stickMode});
      if (reply.type !== "SET_TOUCH_GAMEPAD_RESULT") {throw new Error("RPG_RUNTIME_CONTROL_UNAVAILABLE");}
      enabled = value;
    };
    await setEnabled(enabled);
    touchGamepad = {getState: () => ({enabled}), setEnabled};
  } catch (error) {
    channel.close();
    frame.src = "about:blank";
    throw error;
  }

  return {
    getTouchGamepad: () => touchGamepad,
    getTouchStick: () => touchStick,
    checkpoint: () => channel.save(expectedEngine),
    acknowledgeCheckpoint: checkpoint => channel.acknowledge(checkpoint),
    gameEditor: createNativeGameEditor(channel),
    exit: async () => {
      channel.prepareCleanup();
      await channel.request("CLEANUP", {}, cleanupTimeoutMs).catch(() => undefined);
      channel.close();
      frame.src = "about:blank";
    },
    getCanvas: () => null,
    getCheckpointAvailability: () => channel.checkpointAvailability(),
    getFrameCount: () => channel.frames(),
    startInputDiagnostics: () => channel.inputDiagnostics.start(),
    setHostShortcutPolicy: async (policy, report) => {
      channel.reportHostShortcut = report;
      const reply = await channel.request("SET_HOST_SHORTCUT_POLICY", {policy}, 5_000);
      if (reply.type !== "SET_HOST_SHORTCUT_POLICY_RESULT") {throw new Error("RPG_RUNTIME_CONTROL_UNAVAILABLE");}
    },
    setInputFilter: async (policy) => {
      const reply = await channel.request("SET_INPUT_FILTER", {policy}, 5_000);
      if (reply.type !== "SET_INPUT_FILTER_RESULT") {throw new Error("RPG_RUNTIME_CONTROL_UNAVAILABLE");}
    },
    pause: async () => {await channel.request("PAUSE", {}, 5_000);},
    resume: async () => {await channel.request("RESUME", {}, 5_000);},
    screenshot: () => channel.screenshot(),
    setVideoMode: async (mode) => {
      const reply = await channel.request("SET_VIDEO_MODE", {mode}, 5_000);
      if (reply.type !== "SET_VIDEO_MODE_RESULT") {throw new Error("RPG_RUNTIME_CONTROL_UNAVAILABLE");}
    },
    setVolume: (value) => {void channel.request("SET_VOLUME", { value });},
  } satisfies MountedRuntimeAdapter;
}

export class NativeChannel {
  reportHostShortcut: ((shortcut: RuntimeHostShortcutV1) => void) | null = null;
  readonly inputDiagnostics = new NativeInputDiagnostics((type, body) => this.request(type, body));
  private readonly config: NativeRpgParameters;
  private readonly nonce = randomNonce();
  private readonly port = new MessageChannel();
  private connected = false;
  private closed = false;
  private lastRequestId = 0;
  private pending: Pending | null = null;
  private requestTail: Promise<void> = Promise.resolve();
  private readyValue: { engine: string; engineProfile: string } | null = null;
  private readyWaiter: {resolve: (reply: Reply) => void; reject: (reason: Error) => void; dispose: () => void} | null = null;
  private frameCount = 0;
  private availability: CheckpointAvailability = {available: false, blocker: "NOT_READY", save: inGameSave};
  private statusTimer: number | null = null;
  private statusActive = false;
  private exiting = false;

  constructor(config: NativeRpgParameters, private readonly reportExitRequested: RuntimeExitReporter, private readonly pluginFiles: RpgPluginFile[] = []) {
    this.config = config;
    this.port.port1.onmessage = (event) => this.receive(event.data);
    this.port.port1.start();
  }

  connect(target: Window, saves: RpgCheckpointBundle | null = null) {
    if (this.connected) {throw new Error("RPG_NATIVE_PROTOCOL_INVALID");}
    this.connected = true;
    const bundle = saves ? transferredBundle(saves) : null;
    target.postMessage({
      type: "RPG_RUNTIME_NATIVE_CONNECT", protocolVersion,
      launchId: this.config.sessionId, nonce: this.nonce, parentOrigin: window.location.origin,
      profile: this.config.bridgeProfile, pluginFiles: this.pluginFiles, saves: bundle,
    }, this.config.uniqueOrigin, [this.port.port2, ...this.pluginFiles.map(file => file.data), ...transferables(bundle)]);
  }

  ready(options: NativeReadyOptions = {}) {
    if (options.signal?.aborted) {return Promise.reject(new DOMException("Aborted", "AbortError"));}
    if (this.closed) {return Promise.reject(new Error("RPG_NATIVE_CHANNEL_CLOSED"));}
    if (this.readyValue) {return Promise.resolve(this.readyValue);}
    return new Promise<{ engine: string; engineProfile: string }>((resolve, reject) => {
      const waiter = {resolve: (reply: Reply) => resolve(readReady(reply.body)), reject, dispose: () => {}};
      this.readyWaiter = waiter;
      waiter.dispose = nativeReadyDeadline(options, error => {
        this.readyWaiter = null;
        reject(error);
      });
    });
  }

  request(type: string, body: Record<string, unknown>, timeout = 30000): Promise<Reply> {
    if (!this.connected || this.closed) {return Promise.reject(new Error("RPG_NATIVE_CHANNEL_CLOSED"));}
    const operation = this.requestTail.then(() => this.sendRequest(type, body, timeout));
    this.requestTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private sendRequest(type: string, body: Record<string, unknown>, timeout: number): Promise<Reply> {
    if (this.closed || this.exiting && type !== "CLEANUP") {
      return Promise.reject(new Error("RPG_NATIVE_CHANNEL_CLOSED"));
    }
    if (this.pending) {return Promise.reject(new Error("RPG_NATIVE_PROTOCOL_INVALID"));}
    const requestId = ++this.lastRequestId;
    const message = this.envelope(requestId, type, body);
    if (new TextEncoder().encode(JSON.stringify(message)).byteLength > maximumControlBytes) {
      return Promise.reject(new Error("RPG_NATIVE_CONTROL_TOO_LARGE"));
    }
    return new Promise<Reply>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending = null;
        reject(new Error("RPG_NATIVE_REQUEST_TIMEOUT"));
      }, timeout);
      this.pending = { resolve, reject, timer, type };
      this.port.port1.postMessage(message, transferables(body));
    });
  }

  async save(expectedEngine: "RPGMV" | "RPGMZ") {
    const reply = await this.request("SAVE", {});
    if (reply.type !== "SAVE_RESULT") {throw new Error("RPG_GAME_SAVE_EXPORT_FAILED");}
    const checkpoint = await this.readSave(reply.body, expectedEngine);
    return {...checkpoint, ...(reply.body.screenshot === "UNCHANGED" ? {screenshot: "UNCHANGED" as const} : {})};
  }

  async acknowledge(checkpoint: RuntimeCheckpoint) {
    if (checkpoint.format !== rpgGameSaveFormat) {throw new Error("RPG_GAME_SAVE_INVALID");}
    const bundle = await decodeRpgCheckpoint(checkpoint.bytes, this.config.bridgeProfile);
    const reply = await this.request("ACKNOWLEDGE_SAVE", {bundle: transferredBundle(bundle)});
    if (reply.type !== "ACKNOWLEDGE_SAVE_RESULT") {throw new Error("RPG_GAME_SAVE_ACKNOWLEDGE_FAILED");}
    this.availability = readAvailability(reply.body.availability);
  }

  private async readSave(body: Record<string, unknown>, engine: "RPGMV" | "RPGMZ"): Promise<RuntimeCheckpoint> {
    const data = body.data;
    if (!(data instanceof ArrayBuffer) || !data.byteLength || data.byteLength > maximumCheckpointBytes) {
      throw new Error("RPG_GAME_SAVE_INVALID");
    }
    const bytes = new Uint8Array(data);
    await decodeRpgCheckpoint(bytes, engine);
    return {bytes, format: rpgGameSaveFormat};
  }

  async screenshot() {
    const reply = await this.request("SCREENSHOT", {});
    const data = reply.body.data;
    const mediaType = reply.body.mediaType;
    if (reply.type !== "SCREENSHOT_RESULT" || !(data instanceof ArrayBuffer) || !data.byteLength ||
      data.byteLength > maximumScreenshotBytes || mediaType !== "image/png") {
      throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");
    }
    return new Blob([data], { type: mediaType });
  }

  frames() { return this.frameCount; }
  checkpointAvailability() { return this.availability; }

  startStatusLoop() {
    this.statusActive = true;
    const poll = async () => {
      try {
        const reply = await this.request("STATUS", {}, 5000);
        if (reply.type === "STATUS_RESULT") {
          this.availability = readAvailability(reply.body.availability);
          this.updateFrames(reply.body.frameCount);
          this.inputDiagnostics.update(reply.body.inputDiagnostics);
        }
      } catch {
        this.availability = {available: false, blocker: "NOT_READY", save: inGameSave};
      }
      if (this.statusActive) {
        this.statusTimer = window.setTimeout(() => { void poll(); }, 500);
      }
    };
    void poll();
  }

  stopStatusLoop() {
    this.statusActive = false;
    if (this.statusTimer !== null) {window.clearTimeout(this.statusTimer);}
    this.statusTimer = null;
  }

  prepareCleanup() {
    this.exiting = true;
    this.stopStatusLoop();
    if (this.pending?.type !== "STATUS") {return;}
    const pending = this.pending;
    this.pending = null;
    window.clearTimeout(pending.timer);
    pending.reject(new Error("RPG_NATIVE_CHANNEL_CLOSED"));
  }

  close() {
    this.inputDiagnostics.stop();
    this.closed = true;
    this.reportHostShortcut = null;
    this.stopStatusLoop();
    if (this.pending) {
      window.clearTimeout(this.pending.timer);
      this.pending.reject(new Error("RPG_NATIVE_CHANNEL_CLOSED"));
      this.pending = null;
    }
    if (this.readyWaiter) {
      this.readyWaiter.dispose();
      this.readyWaiter.reject(new Error("RPG_NATIVE_CHANNEL_CLOSED"));
      this.readyWaiter = null;
    }
    this.port.port1.close();
  }

  private envelope(requestId: number, type: string, body: Record<string, unknown>) {
    return { protocolVersion, launchId: this.config.sessionId, nonce: this.nonce, requestId, type, body };
  }

  private receive(value: unknown) {
    if (this.closed) {return;}
    const reply = readReply(value, this.config.sessionId, this.nonce);
    if (!reply) {return;}
    if (reply.requestId === 0) { this.receiveEvent(reply); return; }
    if (!this.pending || reply.requestId !== this.lastRequestId) {return;}
    const pending = this.pending;
    this.pending = null;
    completeChannelReply(pending, reply, "RPG_NATIVE_RUNTIME_FAILED");
  }

  private receiveEvent(reply: Reply) {
    if (reply.type === "HOST_SHORTCUT" && Object.keys(reply.body).join(",") === "shortcut" &&
      (reply.body.shortcut === "MENU" || reply.body.shortcut === "PAUSE")) {
      this.reportHostShortcut?.(reply.body.shortcut);
    } else if (reply.type === "READY") {
      const ready = readReady(reply.body);
      this.readyValue = ready;
      if (this.readyWaiter) {
        const waiter = this.readyWaiter;
        this.readyWaiter = null;
        waiter.dispose();
        waiter.resolve(reply);
      }

    } else if (reply.type === "ERROR") {
      this.readyWaiter?.dispose();
      this.readyWaiter?.reject(new Error(typeof reply.body.code === "string" ? reply.body.code : "RPG_NATIVE_RUNTIME_FAILED"));
      this.readyWaiter = null;
    } else if (reply.type === "EXIT_REQUESTED" && !this.exiting) {
      this.exiting = true;
      this.availability = {available: false, blocker: "NOT_READY", save: inGameSave};
      this.stopStatusLoop();
      void this.reportNativeExit(reply.body);
    }
  }

  private async reportNativeExit(body: Record<string, unknown>) {
    if (body.data === undefined) {this.reportExitRequested(); return;}
    try {
      const checkpoint = await this.readSave(body, this.config.bridgeProfile);
      this.reportExitRequested({checkpoint, screenshot: null});
    } catch {this.reportExitRequested();}
  }

  private updateFrames(value: unknown) {
    if (Number.isSafeInteger(value) && Number(value) >= 0) {this.frameCount = Number(value);}
  }

}

async function bootstrapNativeFrame(config: NativeRpgParameters, frame: HTMLIFrameElement, channel: NativeChannel,
  options: NativeReadyOptions = {}, restorePayload: Uint8Array | null = null) {
  const signal = options.signal;
  if (signal?.aborted) {throw new DOMException("Aborted", "AbortError");}
  const target = frame.contentWindow;
  if (!target) {throw new Error("PLAYER_FRAME_UNAVAILABLE");}
  const runtimeWindow: Window = target;
  await new Promise<void>((resolve, reject) => {
    let dispose = () => {};
    let finished = false;
    function finish(error?: Error) {
      if (finished) {return;}
      finished = true;
      dispose();
      window.removeEventListener("message", receive, true);
      if (error) {reject(error);} else {resolve();}
    }
    let connecting = false;
    function receive(event: MessageEvent) {
      if (event.source !== runtimeWindow || event.origin !== config.uniqueOrigin) {return;}
      if (nativeBootstrapAction(event.data) !== "CONNECT" || connecting) {return;}
      connecting = true;
      void (async () => {
        const saves = restorePayload ? await decodeRpgCheckpoint(restorePayload, config.bridgeProfile) : null;
        if (finished) {return;}
        signal?.throwIfAborted();
        channel.connect(runtimeWindow, saves);
      })().then(() => finish(), error => finish(error as Error));
    }
    window.addEventListener("message", receive, true);
    dispose = nativeReadyDeadline(options, error => finish(error),
      {milliseconds: bootstrapTimeoutMs, code: "RPG_NATIVE_BOOTSTRAP_TIMEOUT"});
  });
}

export function nativeBootstrapAction(value: unknown): NativeBootstrapAction {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "protocolVersion,type") {return "IGNORE";}
  const message = value as { protocolVersion?: unknown; type?: unknown };
  return message.protocolVersion === protocolVersion && message.type === "RPG_RUNTIME_NATIVE_BRIDGE_READY" ? "CONNECT" : "IGNORE";
}

function readReply(value: unknown, launchId: string, nonce: string): Reply | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {return null;}
  const reply = value as Partial<Reply>;
  const keys = Object.keys(value).sort().join(",");
  return keys === "body,launchId,nonce,protocolVersion,requestId,type" && reply.protocolVersion === protocolVersion &&
    reply.launchId === launchId && reply.nonce === nonce && Number.isSafeInteger(reply.requestId) && Number(reply.requestId) >= 0 &&
    typeof reply.type === "string" && reply.body && typeof reply.body === "object" && !Array.isArray(reply.body)
    ? reply as Reply : null;
}

function readReady(body: Record<string, unknown>) {
  if (typeof body.engine !== "string" || typeof body.engineProfile !== "string") {throw new Error("RPG_NATIVE_PROTOCOL_INVALID");}
  return { engine: body.engine, engineProfile: body.engineProfile };
}

function transferredBundle(bundle: RpgCheckpointBundle) {
  return {engine: bundle.engine, entries: bundle.entries.map(entry => ({
    store: entry.store, key: entry.key, mediaType: entry.mediaType, data: entry.data.slice().buffer,
  }))};
}

function readAvailability(value: unknown): CheckpointAvailability {
  if (!value || typeof value !== "object" || !("available" in value)) {throw new Error("RPG_NATIVE_PROTOCOL_INVALID");}
  const save = {...inGameSave, dataKind: readDataKind(value)};
  if (value.available === true && "revision" in value && typeof value.revision === "string") {
    return {available: true, blocker: null, revision: value.revision, save};
  }
  if (value.available === false && "blocker" in value && ["NOT_READY", "NO_SAVE", "UNCHANGED"].includes(String(value.blocker))) {
    return {available: false, blocker: value.blocker as "NOT_READY" | "NO_SAVE" | "UNCHANGED", save};
  }
  throw new Error("RPG_NATIVE_PROTOCOL_INVALID");
}

function readDataKind(value: object): "PROGRESS" | "STORAGE" | undefined {
  const save = "save" in value && value.save && typeof value.save === "object" ? value.save : null;
  const kind = save && "dataKind" in save ? save.dataKind : undefined;
  if (kind === undefined || kind === "PROGRESS" || kind === "STORAGE") {return kind;}
  throw new Error("RPG_NATIVE_PROTOCOL_INVALID");
}

function transferables(value: unknown): Transferable[] {
  const result: Transferable[] = [];
  if (value instanceof ArrayBuffer) {result.push(value);}
  else if (Array.isArray(value)) {value.forEach((item) => result.push(...transferables(item)));}
  else if (value && typeof value === "object") {Object.values(value).forEach((item) => result.push(...transferables(item)));}
  return result;
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
