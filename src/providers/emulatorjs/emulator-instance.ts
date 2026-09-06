import type {EmulatorDiscInstance} from "./discs.js";
import type {EmulatorNativeSettingsInstance} from "./native-settings.js";
import type {EmulatorNetplayInstance} from "./netplay-port.js";
import type {EmulatorGamepadInstance} from "./startup-gamepads.js";
import type {EmulatorDefaultControls} from "./default-controls.js";
import type {retromShaders} from "./shaders.js";

type EjsManager = {
  Module?: {
    HEAPU8?: Uint8Array;
    UTF8ToString?: (pointer: number) => string;
    _free?: (pointer: number) => void;
    _save_state_info?: () => number;
    cwrap?: (name: string, type: "number", args: string[], options: {async: true}) => (...args: (string | number)[]) => Promise<number>;
  };
  FS?: {
    readFile?: (path: string) => ArrayBufferView;
    stat?: (path: string) => {size: number};
    unlink?: (path: string) => void;
    writeFile?: (path: string, bytes: Uint8Array) => void;
  };
  clearEJSResetTimer?: () => void;
  functions?: {loadState?: (path: string, slot: number) => unknown; screenshot?: () => void};
  getFrameNum?: () => number;
  getState?: () => Uint8Array;
  getStateAsync?: () => Promise<Uint8Array>;
  loadExplicitStateAndWait?: (state: Uint8Array) => Promise<void>;
  loadStateAndWait?: (state: Uint8Array) => Promise<unknown>;
  loadState?: (state: Uint8Array) => void;
  getVideoDimensions?: (dimension: "aspect") => number | undefined;
  simulateInput?: (player: number, control: number, value: number) => void;
  toggleMainLoop?: (running: boolean) => void;
};

export type EjsInstance = EmulatorDiscInstance & EmulatorNativeSettingsInstance & EmulatorNetplayInstance & EmulatorGamepadInstance & {
  canvas?: HTMLCanvasElement;
  capture?: {photo?: {source?: string; format?: string; upscale?: number}};
  gameManager?: EjsManager;
  paused?: boolean;
  muted?: boolean;
  volume?: number;
  setVolume?: (value: number) => void;
  changeSettingOption?: (name: string, value: string) => void;
  enableShader?: (name: string) => void;
  takeScreenshot?: (source: string, format: string, upscale: number) => Promise<{blob?: Blob; screenshot?: unknown; format: string}>;
  downloadType?: {rom?: {dontExtractIfCore?: string[]}};
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
};

export type EjsWindow = Window & {
  EJS_player?: string;
  EJS_core?: string;
  EJS_controlScheme?: string;
  EJS_gameUrl?: string;
  EJS_gameName?: string;
  EJS_gameID?: number;
  EJS_pathtodata?: string;
  EJS_biosUrl?: string;
  EJS_gameParentUrl?: string;
  EJS_startOnLoaded?: boolean;
  EJS_dontExtractRom?: boolean;
  EJS_disableBatchBootup?: boolean;
  EJS_language?: string;
  EJS_disableAutoLang?: boolean;
  EJS_DEBUG_XX?: boolean;
  EJS_EXPERIMENTAL_NETPLAY?: boolean;
  EJS_threads?: boolean;
  EJS_fullscreenOnLoaded?: boolean;
  EJS_disableDatabases?: boolean;
  EJS_disableLocalStorage?: boolean;
  EJS_CacheLimit?: number;
  EJS_Buttons?: Record<string, boolean>;
  EJS_defaultControls?: EmulatorDefaultControls;
  EJS_defaultOptions?: Record<string, string>;
  EJS_shaders?: typeof retromShaders;
  EJS_paths?: Record<string, string>;
  EJS_externalFiles?: Record<string, string>;
  EJS_ready?: () => void;
  EJS_onGameStart?: () => void;
  EJS_emulator?: EjsInstance;
};
