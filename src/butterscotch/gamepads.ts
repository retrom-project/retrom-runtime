export type ButterscotchGamepadMode = "shared" | "independent";
type BrowserGamepad = Pick<Gamepad, "axes" | "buttons" | "connected" | "mapping">;
type Snapshot = {axes: number[]; buttons: number[]};

export function readButterscotchGamepads(
  gamepads: readonly (BrowserGamepad | null)[], mode: ButterscotchGamepadMode = "shared",
): Array<Snapshot | null> {
  const slots = Array.from(gamepads).slice(0, 4).map(gamepad =>
    gamepad?.connected && gamepad.mapping === "standard" ? {
      axes: Array.from(gamepad.axes).slice(0, 4),
      buttons: Array.from(gamepad.buttons).slice(0, 17).map(button => button.value),
    } : null);
  // Multiplayer preserves browser slot identity, including holes.
  if (mode === "independent") {return slots;}
  const connected = slots.filter((slot): slot is Snapshot => slot !== null);
  if (!connected.length) {return [];}
  const buttons = Array.from({length: 17}, (_, index) =>
    Math.max(0, ...connected.map(slot => slot.buttons[index] ?? 0)));
  // Opposing D-pad inputs cancel, rather than leaving direction priority to a game.
  for (const [negative, positive] of [[12, 13], [14, 15]]) {
    const difference = buttons[positive] - buttons[negative];
    buttons[negative] = Math.max(0, -difference);
    buttons[positive] = Math.max(0, difference);
  }
  const axes = Array.from({length: 4}, (_, index) => {
    const values = connected.map(slot => slot.axes[index] ?? 0);
    // Same-direction inputs do not amplify; opposite inputs cancel by strength.
    return Math.max(0, ...values) + Math.min(0, ...values);
  });
  // One virtual player stays connected while any physical controller is present.
  return [{axes, buttons}];
}
