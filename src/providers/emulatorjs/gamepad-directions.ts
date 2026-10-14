// These controller layouts expose digital directions, with no native left-stick
// destination. Keep analog consoles and pointer-oriented layouts unchanged.
const digitalCores = new Set([
  "fceumm", "nestopia", "fbneo", "fbalpha", "fbalpha2012_cps1", "fbalpha2012_cps2",
  "mame2003", "mame2003_plus",
]);

type PadReader = {getGamepads?: () => readonly (Gamepad | null)[]};
type Direction = -1 | 0 | 1;
type PreviousPad = {pad: Gamepad; x: Direction; y: Direction};

function direction(value: number | undefined, previous: Direction): Direction {
  if (value === undefined || !Number.isFinite(value)) {return 0;}
  if (value >= .5) {return 1;}
  if (value <= -.5) {return -1;}
  return previous * value > .35 ? previous : 0;
}

function pressed(button: GamepadButton | undefined) {return !!button && (button.pressed || button.value >= .5);}

function digitalPad(pad: Gamepad, x: Direction, y: Direction): Gamepad {
  const buttons = [...pad.buttons];
  for (const [value, negative, positive] of [[x, 14, 15], [y, 12, 13]]) {
    // D-pad wins conflicts on its own axis; the other axis can still form a diagonal.
    if (!value || pressed(buttons[negative]) || pressed(buttons[positive])) {continue;}
    buttons[value < 0 ? negative : positive] = {pressed: true, touched: true, value: 1};
  }
  return snapshot(pad, buttons, pad.axes.map((value, index) => index < 2 ? 0 : value));
}

function snapshot(pad: Gamepad, buttons: readonly GamepadButton[], axes: readonly number[]): Gamepad {
  // Native Gamepad properties are prototype getters, so object spread loses them.
  return {id: pad.id, index: pad.index, mapping: pad.mapping, connected: pad.connected,
    timestamp: pad.timestamp, buttons, axes} as Gamepad;
}

/** Convert at the EJS polling boundary, after Host suppression/chord filtering.
 * One merged button snapshot lets EJS own press/release and player assignment;
 * independent stick events must not release a direction still held on the D-pad.
 */
export function installGamepadDirections(reader: PadReader | undefined, core: string): () => void {
  const original = reader?.getGamepads;
  if (!reader || !original || !digitalCores.has(core)) {return () => undefined;}
  const descriptor = Object.getOwnPropertyDescriptor(reader, "getGamepads");
  let previous = new Map<number, PreviousPad>();
  const getGamepads = () => {
    const current = new Map<number, PreviousPad>();
    const pads = Array.from(original.call(reader), pad => {
      if (!pad || pad.mapping !== "standard") {return pad;}
      if (!pad.connected) {return null;}
      const prior = previous.get(pad.index);
      const held = prior?.pad.id === pad.id ? prior : undefined;
      const x = direction(pad.axes[0], held?.x ?? 0), y = direction(pad.axes[1], held?.y ?? 0);
      const result = digitalPad(pad, x, y);
      current.set(pad.index, {pad: result, x, y});
      return result;
    });
    for (const [index, {pad}] of previous) {
      if (pads.some(candidate => candidate?.index === index)) {continue;}
      // EJS removes a disconnected controller without emitting buttonup. Give
      // it one neutral sample first, then let the following poll disconnect it.
      pads.push(snapshot(pad, pad.buttons.map(() => ({pressed: false, touched: false, value: 0})), pad.axes.map(() => 0)));
    }
    previous = current;
    return pads;
  };
  reader.getGamepads = getGamepads;
  return () => {
    previous.clear();
    if (reader.getGamepads !== getGamepads) {return;}
    if (descriptor) {Object.defineProperty(reader, "getGamepads", descriptor);}
    else {Reflect.deleteProperty(reader, "getGamepads");}
  };
}
