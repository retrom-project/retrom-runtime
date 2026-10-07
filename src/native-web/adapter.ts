import type {RuntimeHostShortcutV1} from "../provider/module-api.js";
import {NativeInputDiagnostics} from "./input-diagnostics.js";
import {createNativeGameEditor} from "./editor.js";
import {nativeReadyDeadline, type NativeReadyOptions} from "./startup-timeout.js";
import {
  decodeRpgCheckpoint,
  encodeRpgCheckpoint,
  type RpgCheckpointBundle,
  type RpgCheckpointStore,
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
  readyOptions: NativeReadyOptions = {},
) {
  const channel = new NativeChannel(config, reportExitRequested);
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");
  frame.referrerPolicy = "no-referrer";
  let expectedEngine: "RPGMV" | "RPGMZ";
  try {
    await bootstrapNativeFrame(config, frame, channel, readyOptions.signal);
    const ready = await channel.ready(readyOptions);
    expectedEngine = config.bridgeProfile;
    if (ready.engine !== expectedEngine || ready.engineProfile !== config.bridgeProfile) {
      throw new Error("RPG_ENGINE_PROFILE_MISMATCH");
    }
    if (restorePayload) {
      const bundle = await decodeRpgCheckpoint(restorePayload, expectedEngine);
      await channel.restore(bundle);
    }
    channel.startStatusLoop();
  } catch (error) {
    channel.close();
    frame.src = "about:blank";
    throw error;
  }

  return {
    checkpoint: async () => ({ bytes: await channel.save(expectedEngine), format: "native-save-bundle-v1" }),
    gameEditor: createNativeGameEditor(channel),
    exit: async () => {
      channel.prepareCleanup();
      await channel.request("CLEANUP", {}, cleanupTimeoutMs).catch(() => undefined);
      channel.close();
      frame.src = "about:blank";
    },
    getCanvas: () => null,
    getCheckpointAvailability: () => channel.checkpointAvailable()
      ? { available: true, blocker: null }
      : { available: false, blocker: "BUSY" },
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
  private available = false;
  private statusTimer: number | null = null;
  private statusActive = false;
  private exiting = false;

  constructor(config: NativeRpgParameters, private readonly reportExitRequested: RuntimeExitReporter) {
    this.config = config;
    this.port.port1.onmessage = (event) => this.receive(event.data);
    this.port.port1.start();
  }

  connect(target: Window) {
    if (this.connected) {throw new Error("RPG_NATIVE_PROTOCOL_INVALID");}
    this.connected = true;
    target.postMessage({
      type: "RPG_RUNTIME_NATIVE_CONNECT", protocolVersion,
      launchId: this.config.sessionId, nonce: this.nonce, parentOrigin: window.location.origin,
      profile: this.config.bridgeProfile,
    }, this.config.uniqueOrigin, [this.port.port2]);
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

  async save(expectedEngine: string) {
    const reply = await this.request("SAVE", {});
    if (reply.type !== "SAVE_RESULT") {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
    const bundle = readBundle(reply.body.bundle, expectedEngine);
    return encodeRpgCheckpoint(bundle);
  }

  async restore(bundle: Awaited<ReturnType<typeof decodeRpgCheckpoint>>) {
    const body = {
      bundle: {
        engine: bundle.engine, resumeSlot: bundle.resumeSlot,
        entries: bundle.entries.map((entry) => ({
          store: entry.store, key: entry.key, mediaType: entry.mediaType, data: entry.data.slice().buffer,
        })),
      },
    };
    const reply = await this.request("RESTORE", body, 30000);
    if (reply.type !== "RESTORE_RESULT") {throw new Error("RPG_CHECKPOINT_RESTORE_FAILED");}
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
  checkpointAvailable() { return this.available; }

  startStatusLoop() {
    this.statusActive = true;
    const poll = async () => {
      try {
        const reply = await this.request("STATUS", {}, 5000);
        if (reply.type === "STATUS_RESULT") {
          this.available = reply.body.ready === true;
          this.updateFrames(reply.body.frameCount);
          this.inputDiagnostics.update(reply.body.inputDiagnostics);
        }
      } catch {
        this.available = false;
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
    window.clearTimeout(pending.timer);
    if (reply.type === "ERROR") {pending.reject(new Error(typeof reply.body.code === "string" ? reply.body.code : "RPG_NATIVE_RUNTIME_FAILED"));}
    else {pending.resolve(reply);}
  }

  private receiveEvent(reply: Reply) {
    if (reply.type === "HOST_SHORTCUT" && Object.keys(reply.body).join(",") === "shortcut" &&
      (reply.body.shortcut === "MENU" || reply.body.shortcut === "PAUSE")) {
      this.reportHostShortcut?.(reply.body.shortcut);
    } else if (reply.type === "READY") {
      const ready = readReady(reply.body);
      this.readyValue = ready;
      this.available = true;
      if (this.readyWaiter) {
        const waiter = this.readyWaiter;
        this.readyWaiter = null;
        waiter.dispose();
        waiter.resolve(reply);
      }

    } else if (reply.type === "EXIT_REQUESTED" && Object.keys(reply.body).length === 0) {
      this.available = false;
      this.reportExitRequested();
    }
  }

  private updateFrames(value: unknown) {
    if (Number.isSafeInteger(value) && Number(value) >= 0) {this.frameCount = Number(value);}
  }

}

async function bootstrapNativeFrame(config: NativeRpgParameters, frame: HTMLIFrameElement, channel: NativeChannel, signal?: AbortSignal) {
  if (signal?.aborted) {throw new DOMException("Aborted", "AbortError");}
  const target = frame.contentWindow;
  if (!target) {throw new Error("PLAYER_FRAME_UNAVAILABLE");}
  const runtimeWindow: Window = target;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("RPG_NATIVE_BOOTSTRAP_TIMEOUT")), bootstrapTimeoutMs);
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    function finish(error?: Error) {
      window.clearTimeout(timer);
      window.removeEventListener("message", receive, true);
      signal?.removeEventListener("abort", abort);
      if (error) {reject(error);} else {resolve();}
    }
    function receive(event: MessageEvent) {
      if (event.source !== runtimeWindow || event.origin !== config.uniqueOrigin) {return;}
      if (nativeBootstrapAction(event.data) === "CONNECT") {channel.connect(runtimeWindow); finish();}
    }
    window.addEventListener("message", receive, true);
    signal?.addEventListener("abort", abort, {once: true});
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

function readBundle(value: unknown, engine: string): RpgCheckpointBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
  const bundle = value as { engine?: unknown; resumeSlot?: unknown; entries?: unknown };
  if (bundle.engine !== engine || !Number.isSafeInteger(bundle.resumeSlot) || Number(bundle.resumeSlot) < 1 ||
    !Array.isArray(bundle.entries) || !bundle.entries.length || bundle.entries.length > 2) {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
  const entries = bundle.entries.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
    const entry = raw as { store?: unknown; key?: unknown; mediaType?: unknown; data?: unknown };
    if ((entry.store !== "LOCAL_STORAGE" && entry.store !== "LOCALFORAGE") || typeof entry.key !== "string" ||
      typeof entry.mediaType !== "string" || !(entry.data instanceof ArrayBuffer) || !entry.data.byteLength ||
      entry.data.byteLength > maximumCheckpointBytes) {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
    const store: RpgCheckpointStore = entry.store;
    if (store !== "LOCAL_STORAGE" && store !== "LOCALFORAGE") {throw new Error("RPG_CHECKPOINT_CREATE_FAILED");}
    return { store, key: entry.key, mediaType: "application/octet-stream" as const, data: new Uint8Array(entry.data) };
  });
  return { engine: engine as "RPGMV" | "RPGMZ", resumeSlot: Number(bundle.resumeSlot), entries };
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
