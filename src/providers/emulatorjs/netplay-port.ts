import type {RuntimeNetplayPortV1} from "../../provider/module-api.js";
import {PlayerRuntimeError} from "../../provider/errors.js";

export type EmulatorNetplayInstance = {
  canvas?: HTMLCanvasElement;
  muted?: boolean;
  paused?: boolean;
  volume?: number;
  setVolume?: (value: number) => void;
  gameManager?: {
    cancelNetplayOperations?: () => void;
    functions?: {simulateInput?: (player: number, control: number, value: number) => void};
    getFrameNum?: () => number;
    getState?: () => Uint8Array;
    loadStateAndWait?: (state: Uint8Array, timeoutMs?: number) => Promise<{byteExact: boolean}>;
    runNetplayFrame?: (timeoutMs?: number) => Promise<number>;
    simulateInput?: (player: number, control: number, value: number) => void;
    toggleFastForward?: (running: boolean) => void;
    toggleMainLoop?: (running: boolean) => void;
  };
};

type NetplayManager = Required<Pick<NonNullable<EmulatorNetplayInstance["gameManager"]>,
  "getState" | "getFrameNum" | "simulateInput" | "toggleMainLoop" | "loadStateAndWait" | "runNetplayFrame">> & {
    functions: {simulateInput: (player: number, control: number, value: number) => void};
    cancelNetplayOperations?: () => void;
    toggleFastForward?: (running: boolean) => void;
  };

export class EmulatorJsNetplayPort implements RuntimeNetplayPortV1 {
  readonly controlCount = 24;
  private readonly manager: NetplayManager;
  private readonly nativeSimulateInput: (player: number, control: number, value: number) => void;
  private readonly publicSimulateInput: (player: number, control: number, value: number) => void;
  private readonly inputCapture: (player: number, control: number, value: number) => void;
  private readonly localControls = new Int16Array(24);
  private closed = false;

  constructor(private readonly runtime: EmulatorNetplayInstance, private readonly maxStateBytes: number) {
    const manager = runtime.gameManager;
    const rawInput = manager?.functions?.simulateInput;
    if (!manager?.getState || !manager.getFrameNum || !manager.simulateInput || !manager.toggleMainLoop ||
      !manager.loadStateAndWait || !manager.runNetplayFrame || !rawInput) {throw contractError();}
    this.manager = manager as NetplayManager;
    this.publicSimulateInput = manager.simulateInput;
    this.nativeSimulateInput = rawInput.bind(manager.functions);
    this.inputCapture = (player, control, value) => {
      if (player === 0 && Number.isSafeInteger(control) && control >= 0 && control < this.controlCount &&
        Number.isFinite(value)) {
        this.localControls[control] = Math.max(-32768, Math.min(32767, Math.trunc(value)));
      }
    };
    manager.simulateInput = this.inputCapture;
  }

  async pauseAtBoundary() {
    this.requireOpen();
    const frame = await this.manager.runNetplayFrame();
    if (!Number.isSafeInteger(frame) || frame < 0) {throw contractError();}
    this.runtime.paused = true;
    return frame;
  }

  async captureState(frame: number) {
    this.requireFrame(frame);
    const state = this.readState();
    coreStateBytes(state);
    return state;
  }

  async loadStateAndWait(state: Uint8Array, frame: number) {
    this.requireFrame(frame);
    if (!(state instanceof Uint8Array) || state.byteLength < 8 || state.byteLength > this.maxStateBytes) {
      throw contractError();
    }
    const expectedCore = coreStateBytes(state);
    const recaptured = await this.withSuppressedOutput(async () => {
      await this.manager.loadStateAndWait(new Uint8Array(state));
      return this.readState();
    });
    if (!equalBytes(coreStateBytes(recaptured), expectedCore)) {throw contractError();}
    this.runtime.paused = true;
  }

  async runFrame(controls: Int16Array, frame: number, suppressOutput: boolean) {
    this.requireFrame(frame);
    if (!(controls instanceof Int16Array) || controls.length !== this.controlCount * 4 ||
      typeof suppressOutput !== "boolean") {throw contractError();}
    const run = async () => {
      for (let player = 0; player < 4; player += 1) {
        for (let control = 0; control < this.controlCount; control += 1) {
          this.nativeSimulateInput(player, control, controls[player * this.controlCount + control]!);
        }
      }
      await this.manager.runNetplayFrame();
      this.runtime.paused = true;
    };
    if (suppressOutput) {await this.withSuppressedOutput(run);}
    else {await run();}
  }

  sampleLocalControls() {this.requireOpen(); return new Int16Array(this.localControls);}
  resetLocalControls() {this.requireOpen(); this.localControls.fill(0);}

  async close() {
    if (this.closed) {return;}
    this.closed = true;
    this.manager.cancelNetplayOperations?.();
    this.manager.toggleMainLoop(false);
    if (this.manager.simulateInput === this.inputCapture) {this.manager.simulateInput = this.publicSimulateInput;}
    this.localControls.fill(0);
  }

  private readState() {
    this.requireOpen();
    const value = this.manager.getState();
    if (!(value instanceof Uint8Array) || value.byteLength < 8 || value.byteLength > this.maxStateBytes) {
      throw contractError();
    }
    return new Uint8Array(value);
  }

  private requireFrame(frame: number) {
    this.requireOpen();
    if (!Number.isSafeInteger(frame) || frame < 0) {throw contractError();}
  }

  private requireOpen() {if (this.closed) {throw contractError();}}

  private async withSuppressedOutput<T>(work: () => Promise<T>) {
    const canvasVisibility = this.runtime.canvas?.style.visibility;
    const muted = this.runtime.muted === true;
    const volume = Number.isFinite(this.runtime.volume) ? this.runtime.volume! : 1;
    try {
      if (this.runtime.canvas) {this.runtime.canvas.style.visibility = "hidden";}
      this.runtime.setVolume?.(0);
      this.runtime.muted = true;
      this.manager.toggleFastForward?.(true);
      return await work();
    } finally {
      this.manager.toggleFastForward?.(false);
      if (this.runtime.canvas) {this.runtime.canvas.style.visibility = canvasVisibility ?? "";}
      this.runtime.muted = muted;
      this.runtime.setVolume?.(muted ? 0 : volume);
    }
  }
}

export function coreStateBytes(value: Uint8Array) {
  if (new TextDecoder().decode(value.subarray(0, 7)) !== "RASTATE" || value[7] !== 1) {throw contractError();}
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  for (let offset = 8; offset + 8 <= value.byteLength;) {
    const marker = new TextDecoder().decode(value.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end > value.byteLength) {throw contractError();}
    if (marker === "MEM ") {return value.subarray(start, end);}
    if (marker === "END ") {break;}
    offset = start + ((size + 7) & ~7);
  }
  throw contractError();
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
function contractError(cause?: unknown) {
  return new PlayerRuntimeError("PLAYER_RUNTIME_CONTRACT_INVALID", {cause});
}
