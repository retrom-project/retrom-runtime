export type EmulatorGamepadInstance = {
  gamepad?: {
    gamepads: readonly {id: string; index: number}[];
    listeners?: Record<string, ((event: {gamepadIndex: number; [key: string]: unknown}) => void) | undefined>;
  };
  gamepadSelection?: string[];
  gameManager?: {simulateInput?: (player: number, control: number, value: number) => void};
  updateGamepadLabels?: () => void;
};

export function initializeEmulatorJsGamepads(instance: EmulatorGamepadInstance): () => void {
  const selection = instance.gamepadSelection;
  if (!selection || !instance.gamepad) {return () => undefined;}
  const gamepad = instance.gamepad;
  const listeners = gamepad.listeners;
  const restore: (() => void)[] = [];
  let playerOneClaimed = false;
  // EmulatorJS stores connected pads densely but treats the browser's Gamepad.index
  // as an array position in these callbacks. A sole pad at index 1 otherwise
  // throws on its first button press and stops the polling loop.
  for (const eventName of ["connected", "buttondown", "buttonup", "axischanged"] as const) {
    const original = listeners?.[eventName];
    if (!original || !listeners) {continue;}
    const wrapped: typeof original = event => {
      const position = gamepad.gamepads.findIndex(pad => pad?.index === event.gamepadIndex);
      if (position < 0) {return;}
      if (eventName === "buttondown" && !playerOneClaimed) {
        const pad = gamepad.gamepads[position];
        const id = `${pad.id}_${pad.index}`;
        const assigned = selection.indexOf(id);
        if (assigned > 0) {
          // A passive or drifting controller can enumerate first. The first
          // deliberate button press chooses P1; retain the displaced P1 as P2.
          const previous = selection[0];
          selection[0] = id;
          selection[assigned] = previous;
          for (let control = 0; control < 30; control += 1) {
            instance.gameManager?.simulateInput?.(0, control, 0);
          }
          instance.updateGamepadLabels?.();
        }
        if (assigned >= 0) {playerOneClaimed = true;}
      }
      original({...event, gamepadIndex: position});
    };
    listeners[eventName] = wrapped;
    restore.push(() => {if (listeners[eventName] === wrapped) {listeners[eventName] = original;}});
  }
  // GamepadHandler polls synchronously in its constructor, before EmulatorJS
  // subscribes to "connected". Reconcile that initial snapshot once, after the
  // control menu exists; later connections remain owned by EmulatorJS.
  let changed = false;
  for (const pad of gamepad.gamepads) {
    const id = `${pad.id}_${pad.index}`;
    if (selection.includes(id)) {continue;}
    const player = selection.indexOf("");
    if (player < 0) {break;}
    selection[player] = id;
    changed = true;
  }
  if (changed) {instance.updateGamepadLabels?.();}
  return () => {for (const cleanup of restore) {cleanup();}};
}
