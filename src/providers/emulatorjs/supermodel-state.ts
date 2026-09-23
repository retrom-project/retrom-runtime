type StateManager = {
  Module?: {
    HEAPU8?: Uint8Array;
    EmulatorJSGetState?: () => Uint8Array;
    cwrap?: (name: string, result: "string", arguments_: string[]) => () => string;
  };
  getState?: () => Uint8Array | Promise<Uint8Array>;
};

// The pinned RetroArch Web build exports save_state_info, while the 4.3
// EmulatorJS frontend calls the newer EmulatorJSGetState convenience method.
// Translate only for Supermodel; keep the native serializer and its ownership.
export function installSupermodelState(manager: StateManager) {
  const module = manager.Module;
  if (!module?.HEAPU8 || typeof module.cwrap !== "function" || typeof manager.getState !== "function") {
    throw new Error("PLAYER_STATE_COMPATIBILITY_UNAVAILABLE");
  }
  if (typeof module.EmulatorJSGetState === "function") {return () => undefined;}
  const serialize = module.cwrap("save_state_info", "string", []);
  if (typeof serialize !== "function") {throw new Error("PLAYER_STATE_COMPATIBILITY_UNAVAILABLE");}
  const original = manager.getState;
  manager.getState = () => {
    const [lengthText, pointerText, status] = String(serialize()).split("|");
    const length = Number(lengthText);
    const pointer = Number(pointerText);
    const heap = module.HEAPU8;
    if (status !== "1" || !Number.isSafeInteger(length) || length < 1 ||
      !Number.isSafeInteger(pointer) || pointer < 0 || !heap ||
      pointer + length > heap.byteLength) {
      throw new Error("PLAYER_SAVE_STATE_INVALID");
    }
    return heap.slice(pointer, pointer + length);
  };
  return () => {manager.getState = original;};
}
