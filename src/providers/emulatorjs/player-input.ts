import {RuntimeHostShortcuts} from "../../provider/host-shortcuts.js";
import {RuntimeGamepadFilter, installRuntimeGamepadFilter, validInputFilterPolicy} from "../../provider/gamepad-filter.js";
import {providerInputCapabilities} from "../../provider/input-capabilities.js";
import {PlayerRuntimeError} from "../../provider/errors.js";
import type {LaunchEnvelopeV1, RuntimeEventV1, RuntimeHostShortcutPolicyV1, RuntimeInputFilterPolicyV1, RuntimeStateV1} from "../../provider/module-api.js";
import {emulatorJsProviderDefinition} from "./catalog.js";

/** Owns all Host input policy installed in the EmulatorJS game realm. */
export class EmulatorPlayerInput {
  private readonly shortcuts: RuntimeHostShortcuts;
  private runtimeWindow: Window | null = null;
  private filter: RuntimeGamepadFilter | null = null;
  private cleanupFilter: (() => void) | null = null;
  constructor(private readonly envelope: LaunchEnvelopeV1, private readonly signal: AbortSignal,
    private readonly state: () => RuntimeStateV1, emit: (event: RuntimeEventV1) => void) {
    this.shortcuts = new RuntimeHostShortcuts(providerInputCapabilities(emulatorJsProviderDefinition, envelope.runtime.targetId).hostShortcuts,
      shortcut => emit({type: "HOST_SHORTCUT", shortcut}), () => ["RUNNING", "PAUSED"].includes(state()) &&
        !this.runtimeWindow?.document.documentElement.classList.contains("retrom-native-panel-open"));
  }
  bind(runtimeWindow: Window) {
    this.runtimeWindow = runtimeWindow;
    this.shortcuts.bind(runtimeWindow);
    this.installFilter();
  }
  setHostShortcutPolicy(policy: RuntimeHostShortcutPolicyV1 | null) {
    this.assertActive(); this.shortcuts.setPolicy(policy);
  }
  setInputFilter(policy: RuntimeInputFilterPolicyV1 | null) {
    this.assertActive();
    if (!this.envelope.runtime.capabilities.inputFilter) {throw new PlayerRuntimeError("PLAYER_RUNTIME_CAPABILITY_UNSUPPORTED");}
    if (!validInputFilterPolicy(policy)) {throw new PlayerRuntimeError("PLAYER_RUNTIME_CONTRACT_INVALID");}
    this.shortcuts.setSuppressed(policy?.suppressInput === true);
    if (policy === null) {this.cleanupFilter?.(); this.cleanupFilter = null; this.filter = null; return;}
    if (this.filter) {this.filter.setPolicy(policy);} else {this.filter = new RuntimeGamepadFilter(policy);}
    this.installFilter();
  }
  stop() {
    this.shortcuts.stop(); this.cleanupFilter?.(); this.cleanupFilter = null;
    this.filter = null; this.runtimeWindow = null;
  }
  private installFilter() {
    if (this.runtimeWindow && this.filter && !this.cleanupFilter) {
      try {this.cleanupFilter = installRuntimeGamepadFilter(this.runtimeWindow, this.filter);}
      catch (cause) {throw new PlayerRuntimeError("PLAYER_RUNTIME_CONTRACT_INVALID", {cause});}
    }
  }
  private assertActive() {
    if (this.signal.aborted || ["FAILED", "EXITING", "EXITED"].includes(this.state())) {
      throw new PlayerRuntimeError("PLAYER_RUNTIME_CONTRACT_INVALID");
    }
  }
}
