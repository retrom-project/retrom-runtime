import {RuntimeFailureError} from "../provider/failure.js";
import {mountMameMedia} from "./media-fs.js";
import {runMameWorker} from "./worker.js";

/** Private adapter RPC; file reads use the public content bridge, never this command channel. */
export class MameWorkerClient {
  private readonly worker: Worker;
  private sequence = 0;
  private stopped = false;
  private readonly pending = new Map<number, {resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>}>();
  constructor() {
    const source = `(${runMameWorker.toString()})(${mountMameMedia.toString()});`;
    const url = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
    try {this.worker = new Worker(url, {type: "module", name: "retrom-mame"});}
    finally {URL.revokeObjectURL(url);}
    this.worker.onmessage = ({data}: MessageEvent<{id: number; result?: unknown; error?: string; messages?: string[]}>) => {
      const item = this.pending.get(data.id); if (!item) {return;}
      this.pending.delete(data.id); clearTimeout(item.timer);
      if (data.error) {item.reject(new RuntimeFailureError(data.error, "CORE", data.messages));} else {item.resolve(data.result);}
    };
    this.worker.onerror = event => {event.preventDefault(); this.close(new Error(event.message || "MAME_WORKER_FAILED"));};
    this.worker.onmessageerror = () => this.close(new Error("MAME_WORKER_FAILED"));
  }
  request<T>(command: string, payload: unknown = null, transfer: Transferable[] = [], timeout = 120000): Promise<T> {
    if (this.stopped) {return Promise.reject(new Error("MAME_RUNTIME_STOPPED"));}
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error("MAME_WORKER_TIMEOUT")), timeout);
      this.pending.set(id, {resolve: value => resolve(value as T), reject, timer});
      try {this.worker.postMessage({id, command, payload}, transfer);}
      catch (error) {this.close(error instanceof Error ? error : new Error("MAME_WORKER_FAILED"));}
    });
  }
  close(error = new Error("MAME_RUNTIME_STOPPED")) {
    if (this.stopped) {return;} this.stopped = true; this.worker.terminate();
    for (const item of this.pending.values()) {clearTimeout(item.timer); item.reject(error);} this.pending.clear();
  }
}
