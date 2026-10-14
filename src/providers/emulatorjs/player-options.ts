import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import type {EmulatorImplementation} from "./catalog.js";
import type {EjsWindow} from "./emulator-instance.js";
import {createRetromDefaultControls, emulatorPointerOptions, thomsonOptions} from "./default-controls.js";
import {emulatorVirtualControls} from "./virtual-controls.js";
import {flycastDiscBootOptions} from "./disc-mount.js";
import {optionalResource} from "./resources.js";
import {retromShaders} from "./shaders.js";

export function configurePlayerOptions(win: EjsWindow, implementation: EmulatorImplementation, envelope: LaunchEnvelopeV1, gameURL: string) {
  const core = implementation.runtimeCore;
  win.EJS_defaultControls = createRetromDefaultControls(core, gameURL);
  win.EJS_VirtualGamepadSettings = emulatorVirtualControls(core);
  win.EJS_defaultOptions = {...implementation.defaultOptions,
    ...emulatorPointerOptions(core), ...(core === "theodore" ? thomsonOptions(envelope.targetOptions) : {}),
    ...(optionalResource(envelope, "bios", "BIOS_BUNDLE") ? implementation.biosOptions : {}),
    ...flycastDiscBootOptions(core, gameURL),
    ...(["daphne", "dosbox_pure"].includes(core) ? {shader: "disabled"} : {}),
    ...(core === "cap32" && new URL(gameURL, "http://runtime.invalid").pathname.toLowerCase().endsWith(".cpr")
      ? {cap32_model: "6128+ (experimental)", cap32_gfx_colors: "24bit"} : {}),
  };
  win.EJS_shaders = retromShaders;
}
