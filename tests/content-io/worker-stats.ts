// Test-only parent-port observation; production management capabilities cannot request internal state.
import type {ContentSessionService} from "../../src/content-io/service.js";
export function workerStats(worker: Worker): Promise<ContentSessionService["stats"]> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID(), timer = setTimeout(() => {worker.removeEventListener("message", listener); reject(new Error("TRACE_STATS_TIMEOUT"));}, 5000);
    const listener = ({data}: MessageEvent) => {
      if (data.id === id) {clearTimeout(timer); worker.removeEventListener("message", listener); resolve(data.stats);}
    };
    worker.addEventListener("message", listener); worker.postMessage({type: "TEST_STATS", id});
  });
}
