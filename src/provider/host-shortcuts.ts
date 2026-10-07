import type {RuntimeHostShortcutPolicyV1, RuntimeHostShortcutV1} from "./module-api.js";

export function validHostShortcutPolicy(value: unknown): value is RuntimeHostShortcutPolicyV1 | null {
  if (value === null) {return true;}
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "menu,pause") {return false;}
  const policy = value as RuntimeHostShortcutPolicyV1;
  return (policy.menu === null || policy.menu === "Escape" || policy.menu === "KeyM") && typeof policy.pause === "boolean";
}

/** One keyboard owner for a game realm, including the isolated bridge's own window. */
export class RuntimeHostShortcuts {
  private policy: RuntimeHostShortcutPolicyV1 | null = null;
  private suppressed = false;
  private runtimeWindow: Window | null = null;
  private listening = false;
  private readonly held = new Set<string>();
  constructor(
    private readonly allowed: readonly RuntimeHostShortcutV1[],
    private readonly report: (shortcut: RuntimeHostShortcutV1) => void,
    private readonly active: () => boolean,
  ) {}

  setPolicy(policy: RuntimeHostShortcutPolicyV1 | null) {
    if (!validHostShortcutPolicy(policy) || policy &&
      (policy.menu !== null && !this.allowed.includes("MENU") || policy.pause && !this.allowed.includes("PAUSE"))) {
      throw new Error("PLAYER_HOST_SHORTCUT_POLICY_INVALID");
    }
    this.policy = policy ? {...policy} : null;
    this.held.clear();
    this.refresh();
  }
  setSuppressed(value: boolean) {this.suppressed = value; this.held.clear(); this.refresh();}
  bind(runtimeWindow: Window) {this.detach(); this.runtimeWindow = runtimeWindow; this.refresh();}
  stop() {this.detach(); this.runtimeWindow = null; this.policy = null;}
  receive(shortcut: RuntimeHostShortcutV1) {
    if (this.enabled(shortcut)) {this.report(shortcut);}
  }
  private enabled(shortcut: RuntimeHostShortcutV1) {
    return !this.suppressed && this.active() && this.allowed.includes(shortcut) &&
      (shortcut === "MENU" ? this.policy?.menu != null : this.policy?.pause === true);
  }
  private readonly keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || editable(event)) {return;}
    const code = event.code || event.key;
    const shortcut = this.policy?.menu === code ? "MENU"
      : this.policy?.pause && (code === "Pause" || code === "KeyP") ? "PAUSE" : null;
    if (!shortcut || !this.enabled(shortcut)) {return;}
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat || this.held.has(code)) {return;}
    this.held.add(code);
    this.report(shortcut);
  };
  private readonly keyup = (event: KeyboardEvent) => {
    if (this.held.delete(event.code || event.key)) {event.preventDefault(); event.stopImmediatePropagation();}
  };
  private readonly blur = () => this.held.clear();
  private refresh() {
    const wanted = this.policy !== null && !this.suppressed;
    if (this.listening && !wanted) {this.detach();}
    if (!this.listening && wanted && this.runtimeWindow) {
      this.runtimeWindow.addEventListener("keydown", this.keydown, true);
      this.runtimeWindow.addEventListener("keyup", this.keyup, true);
      this.runtimeWindow.addEventListener("blur", this.blur);
      this.listening = true;
    }
  }
  private detach() {
    if (this.listening && this.runtimeWindow) {
      this.runtimeWindow.removeEventListener("keydown", this.keydown, true);
      this.runtimeWindow.removeEventListener("keyup", this.keyup, true);
      this.runtimeWindow.removeEventListener("blur", this.blur);
    }
    this.listening = false; this.held.clear();
  }
}
function editable(event: KeyboardEvent) {
  return event.composedPath().some(target => {
    const element = target as Element;
    return typeof element.matches === "function" && (element.matches("input,select,textarea") ||
      element.closest('[contenteditable]:not([contenteditable="false"])') !== null);
  });
}
