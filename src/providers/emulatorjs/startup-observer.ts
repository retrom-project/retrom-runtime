import {observeRuntimeErrors} from "../../provider/runtime-errors.js";
import {StartupDeadline} from "../../provider/startup-deadline.js";
import {observeStartupNetwork} from "../../provider/startup-network.js";
import {runtimeStartTimeout} from "./lifecycle.js";

/** Keep startup observers and their cleanup together for the frame lifecycle. */
export function observeEmulatorJsStartup(runtimeWindow: Window, signal: AbortSignal,
  core: string, restoring: boolean, fail: (error: Error & {code: string}) => void) {
  const deadline = new StartupDeadline(runtimeWindow, signal, fail, runtimeStartTimeout(core, restoring));
  const stopNetwork = observeStartupNetwork(runtimeWindow, deadline);
  const stopErrors = observeRuntimeErrors(runtimeWindow, fail);
  return {
    deadline,
    ready() {deadline.stop(); stopNetwork(false);},
    stop(abort: boolean) {
      deadline.stop();
      stopErrors();
      stopNetwork(abort);
    },
  };
}
