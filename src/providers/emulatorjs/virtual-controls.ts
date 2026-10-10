export type EmulatorVirtualControl = {
  type: "button" | "dpad";
  id: string;
  location: "left" | "right" | "center";
  text?: string;
  input_value?: number;
  inputValues?: number[];
  left?: number | string;
  top?: number | string;
  fontSize?: number;
  bold?: boolean;
  block?: boolean;
  joystickInput?: boolean;
};

// Only override cores whose generic EJS layout mislabels native actions. Native
// controller schemes stay intact, including NDS stylus/analog and Sega six-key.
export function emulatorVirtualControls(core: string): EmulatorVirtualControl[] | undefined {
  const letterFaces = ["azahar", "desmume", "desmume2015", "melonds", "lutro", "prboom", "same_cdi"].includes(core);
  let face: readonly (readonly [number, string])[];
  if (letterFaces) {face = [[0, "B"], [8, "A"], [1, "Y"], [9, "X"]];}
  else if (["ardens", "sameduck", "potator", "gearboy"].includes(core)) {face = [[0, "B"], [8, "A"]];}
  else if (core === "freeintv") {face = [[8, "Left"], [0, "Right"], [1, "Top"], [9, "Keypad"]];}
  else if (core === "fuse") {face = [[8, "Fire"], [0, "Up"], [9, "X"], [1, "Y"]];}
  else if (core === "vecx") {face = [[8, "1"], [0, "2"], [9, "3"], [1, "4"]];}
  else if (core === "crocods") {face = [[8, "Fire 1"], [0, "Fire 2"]];}
  else if (core === "cap32") {face = [[8, "Fire 1"], [0, "Fire 2"], [9, "Fire 3"], [1, "Space"]];}
  else if (core === "theodore") {face = [[0, "Fire"], [8, "Space"], [1, "Keyboard"]];}
  else if (core === "quasi88") {face = [[3, "Return"], [0, "Z"], [9, "Shift"], [1, "Space"]];}
  else {return undefined;}

  const positions = [[40, 80], [81, 40], [0, 40], [40, 0]];
  const controls: EmulatorVirtualControl[] = face.map(([slot, text], index) => ({
    type: "button", id: `native_${slot}`, location: "right", text, input_value: slot,
    left: positions[index][0], top: positions[index][1], bold: true,
    fontSize: text.length > 2 ? 15 : 30,
  }));
  controls.push({type: "dpad", id: "dpad", location: "left", left: "50%", top: "50%", joystickInput: false, inputValues: [4, 5, 6, 7]});
  controls.push({type: "button", id: "start", location: "center", left: 60, text: core === "quasi88" ? "X" : "Start", input_value: core === "quasi88" ? 8 : 3, fontSize: 15, block: true});
  controls.push({type: "button", id: "select", location: "center", left: -5, text: "Select", input_value: 2, fontSize: 15, block: true});
  if (["azahar", "desmume", "desmume2015", "melonds"].includes(core)) {
    controls.push({type: "button", id: "l", location: "left", left: 3, top: -100, text: "L", input_value: 10, bold: true, block: true});
    controls.push({type: "button", id: "r", location: "right", left: 81, top: -100, text: "R", input_value: 11, bold: true, block: true});
  }
  controls.push({type: "button", id: "speed_fast", location: "center", left: -35, top: 50, text: "Fast", input_value: 27, fontSize: 15, block: true});
  controls.push({type: "button", id: "speed_slow", location: "center", left: 95, top: 50, text: "Slow", input_value: 29, fontSize: 15, block: true});
  return controls;
}
