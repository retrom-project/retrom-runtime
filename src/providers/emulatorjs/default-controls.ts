export type EmulatorControlBinding = {
  value: string;
  value2?: string;
};

export type EmulatorDefaultControls = Record<number, Record<number, EmulatorControlBinding>>;

export function emulatorControlScheme(core: string, release: "4.2.3" | "4.3.0-pre", gameUrl = "") {
  if (core === "neocd") {return "arcade";}
  if (!["genesis_plus_gx", "genesis_plus_gx_wide", "picodrive"].includes(core)) {return undefined;}
  const extension = new URL(gameUrl, "http://runtime.invalid").pathname.toLowerCase().split(".").pop();
  if (extension === "gg") {return "segaGG";}
  if (extension === "sg" || extension === "sms") {return "segaMS";}
  // Auto-detection picks Master System for these multi-system cores and removes
  // Start/A/X/Y/Z. In 4.2.3 only the segaCD alias exposes the MD six-button layout
  // in both native settings and touch controls; this does not change the core.
  return release === "4.2.3" ? "segaCD" : "segaMD";
}

const controlCount = 30;

const playerOneKeyboard: Readonly<Record<number, string>> = {
  0: "j",
  1: "l",
  2: "5",
  3: "1",
  4: "w",
  5: "s",
  6: "a",
  7: "d",
  8: "k",
  9: "i",
};

const playerTwoKeyboard: Readonly<Record<number, string>> = {
  0: "numpad 1",
  1: "numpad 3",
  // Coin is shared through P1 control 2. EmulatorJS dispatches every same-key
  // match, so binding P2 here would inject two coin slots for one key press.
  3: "2",
  4: "up arrow",
  5: "down arrow",
  6: "left arrow",
  7: "right arrow",
  8: "numpad 2",
  9: "numpad 5",
};

// These are the pinned EmulatorJS 4.2.3/4.3 defaults. Keyboard overrides must
// retain them byte-for-byte so connecting a gamepad behaves as before.
const playerOneGamepad: Readonly<Record<number, string>> = {
  0: "BUTTON_2",
  1: "BUTTON_4",
  2: "SELECT",
  3: "START",
  4: "DPAD_UP",
  5: "DPAD_DOWN",
  6: "DPAD_LEFT",
  7: "DPAD_RIGHT",
  8: "BUTTON_1",
  9: "BUTTON_3",
  10: "LEFT_TOP_SHOULDER",
  11: "RIGHT_TOP_SHOULDER",
  12: "LEFT_BOTTOM_SHOULDER",
  13: "RIGHT_BOTTOM_SHOULDER",
  14: "LEFT_STICK",
  15: "RIGHT_STICK",
  16: "LEFT_STICK_X:+1",
  17: "LEFT_STICK_X:-1",
  18: "LEFT_STICK_Y:+1",
  19: "LEFT_STICK_Y:-1",
  20: "RIGHT_STICK_X:+1",
  21: "RIGHT_STICK_X:-1",
  22: "RIGHT_STICK_Y:+1",
  23: "RIGHT_STICK_Y:-1",
};

// Flycast and NeoCD map libretro B/A/Y/X to their native A/B/left/top
// actions. Keep the primary action on the bottom standard gamepad button.
const nativeFaceGamepad: Readonly<Record<number, string>> = {...playerOneGamepad, 0: "BUTTON_1", 8: "BUTTON_2", 1: "BUTTON_3", 9: "BUTTON_4"};

// PC-88 confirmation is Return (native Start). Swap the two bindings so
// each physical button still sends exactly one native control.
const pc88Gamepad: Readonly<Record<number, string>> = {...playerOneGamepad, 3: "BUTTON_1", 8: "START"};

export function createRetromDefaultControls(core?: string): EmulatorDefaultControls {
  const gamepad = ["flycast", "neocd"].includes(core ?? "") ? nativeFaceGamepad : core === "quasi88" ? pc88Gamepad : playerOneGamepad;
  const controllers: EmulatorDefaultControls = {};
  for (let player = 0; player < 4; player += 1) {
    const keyboard: Readonly<Record<number, string>> = player === 0
      ? playerOneKeyboard
      : player === 1 ? playerTwoKeyboard : {};
    const controls: Record<number, EmulatorControlBinding> = {};
    for (let control = 0; control < controlCount; control += 1) {
      // NeoCD shoulder/stick clicks are native multi-button macros; leave them unbound.
      const macro = core === "neocd" && control >= 10 && control <= 15;
      const value2 = player === 0 && !macro ? gamepad[control] : undefined;
      controls[control] = {
        value: keyboard[control] ?? "",
        ...(value2 ? {value2} : {}),
      };
    }
    controllers[player] = controls;
  }
  return controllers;
}
