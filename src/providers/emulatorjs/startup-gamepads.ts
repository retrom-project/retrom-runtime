export type EmulatorGamepadInstance = {
  gamepad?: {gamepads: readonly {id: string; index: number}[]};
  gamepadSelection?: string[];
  updateGamepadLabels?: () => void;
};

export function initializeEmulatorJsGamepads(instance: EmulatorGamepadInstance) {
  const selection = instance.gamepadSelection;
  if (!selection || !instance.gamepad) {return;}
  // GamepadHandler polls synchronously in its constructor, before EmulatorJS
  // subscribes to "connected". Reconcile that initial snapshot once, after the
  // control menu exists; later connections remain owned by EmulatorJS.
  let changed = false;
  for (const gamepad of instance.gamepad.gamepads) {
    const id = `${gamepad.id}_${gamepad.index}`;
    if (selection.includes(id)) {continue;}
    const player = selection.indexOf("");
    if (player < 0) {break;}
    selection[player] = id;
    changed = true;
  }
  if (changed) {instance.updateGamepadLabels?.();}
}
