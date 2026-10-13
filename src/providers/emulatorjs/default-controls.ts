export type EmulatorControlBinding = {
  value: string;
  value2?: string;
};

export type EmulatorDefaultControls = Record<number, Record<number, EmulatorControlBinding>>;

export function emulatorControlScheme(core: string, release: "4.2.3" | "4.3.0-pre", gameUrl = "") {
  // The NDS layout removes the native stylus triggers and both analog sticks.
  // The generic libretro layout retains these controls and exposes their bindings.
  if (["desmume", "desmume2015", "melonds"].includes(core)) {return "generic";}
  if (["neocd", "fbalpha"].includes(core)) {return "arcade";}
  if (core === "uzem" || core === "gam4980") {return "snes";}
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

// Letter-oriented platforms (including Nintendo) use A/B/X/Y. Libretro's
// numeric slots describe RetroPad positions, which are not every core's letters.
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

// Position-oriented cores use B/A/Y/X for bottom/right/left/top respectively.
const nativeFaceGamepad: Readonly<Record<number, string>> = {...playerOneGamepad, 0: "BUTTON_1", 8: "BUTTON_2", 1: "BUTTON_3", 9: "BUTTON_4"};

const positionalCores = new Set([
  "daphne", "dosbox_pure", "flycast", "neocd", "o2em", "puae",
  "fbalpha", "fbneo", "fbalpha2012_cps1", "fbalpha2012_cps2", "mame2003", "mame2003_plus",
  "supermodel", "pcsx_rearmed", "mednafen_psx_hw", "ppsspp",
  "atari800", "a5200", "freechaf", "hatarib",
  "vice_x128", "vice_x64", "vice_x64sc", "vice_xpet", "vice_xplus4", "vice_xvic",
]);

const primaryButtonCores = new Set(["mednafen_ngp", "smsplus", "prosystem", "stella2014", "81", "theodore"]);
const primaryButtonGamepad = {...playerOneGamepad, 0: "BUTTON_1", 8: "BUTTON_2"};

// N64 layouts retain native 0/1 for A/B and remove 8/9. C buttons remain on
// the right stick, so unused face buttons must not duplicate those inputs.
const n64Gamepad = {...playerOneGamepad, 0: "BUTTON_1", 1: "BUTTON_2", 8: "BUTTON_3", 9: "BUTTON_4"};

// Sega: A/B/X/Y on like-named standard buttons, C on R1 and Z on L1.
// Saturn's X/Y native slots differ from Mega Drive's; SMS/GG are two-button.
const megaDriveGamepad = {...playerOneGamepad, 1: "BUTTON_1", 0: "BUTTON_2", 10: "BUTTON_3", 9: "BUTTON_4", 8: "RIGHT_TOP_SHOULDER", 11: "LEFT_TOP_SHOULDER"};
const saturnGamepad = {...megaDriveGamepad, 9: "BUTTON_3", 10: "BUTTON_4"};
const threeDOGamepad = {...playerOneGamepad, 1: "BUTTON_1", 0: "BUTTON_2", 8: "BUTTON_3", 9: "BUTTON_4"};

function isSegaEightBit(gameUrl: string) {
  const extension = new URL(gameUrl, "http://runtime.invalid").pathname.toLowerCase().split(".").pop();
  return extension === "sms" || extension === "sg" || extension === "gg";
}

// PC-88 confirmation is Return (native Start). Swap the two bindings so
// each physical button still sends exactly one native control.
const pc88Gamepad: Readonly<Record<number, string>> = {...playerOneGamepad, 3: "BUTTON_1", 8: "START"};

function gamepadControls(core: string, gameUrl: string): Readonly<Record<number, string>> {
  return positionalCores.has(core) ? nativeFaceGamepad
    : primaryButtonCores.has(core) ? primaryButtonGamepad
    : core === "mupen64plus_next" || core === "parallel_n64" ? n64Gamepad
    : ["genesis_plus_gx", "genesis_plus_gx_wide", "picodrive"].includes(core) ? (isSegaEightBit(gameUrl) ? primaryButtonGamepad : megaDriveGamepad)
    : core === "yabause" ? saturnGamepad : core === "opera" ? threeDOGamepad
    : core === "quasi88" ? pc88Gamepad : playerOneGamepad;
}

export function createRetromDefaultControls(core = "", gameUrl = ""): EmulatorDefaultControls {
  const gamepad = gamepadControls(core, gameUrl);
  const controllers: EmulatorDefaultControls = {};
  for (let player = 0; player < 4; player += 1) {
    const keyboard: Readonly<Record<number, string>> = player === 0
      ? playerOneKeyboard
      : player === 1 ? playerTwoKeyboard : {};
    const controls: Record<number, EmulatorControlBinding> = {};
    for (let control = 0; control < controlCount; control += 1) {
      // NeoCD shoulder/stick clicks are native multi-button macros; leave them unbound.
      const macro = core === "neocd" && control >= 10 && control <= 15;
      const value2 = (player === 0 || core === "o2em" && player === 1) && !macro ? gamepad[control] : undefined;
      controls[control] = {
        value: keyboard[control] ?? "",
        ...(value2 ? {value2} : {}),
      };
    }
    controllers[player] = controls;
  }
  return controllers;
}


export function thomsonOptions(options: Readonly<Record<string, unknown>>): Record<string, string> {
  return typeof options.thomsonModel === "string" ? {theodore_rom: options.thomsonModel} : {};
}

export function emulatorPointerOptions(core: string): Record<string, string> {
  // DeSmuME accepts mouse and emulated analog input together. melonDS exposes
  // mutually exclusive touch modes, so retain its public mode selection.
  return ["desmume", "desmume2015"].includes(core) ? {desmume_pointer_device_r: "emulated"} : {};
}
