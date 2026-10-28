import {touchGamepadProfiles, type TouchGamepadLayoutOptions} from "../provider/touch-gamepad-layout.js";

/** Both execution paths expose the same standard pad to the existing MAME input mapper. */
export function mameTouchGamepad(machine: string, arcade = false): TouchGamepadLayoutOptions | undefined {
  if (arcade) {
    return {...touchGamepadProfiles.action, auxiliary: [
      {index: 8, label: "投币", side: "center-left"}, {index: 9, label: "开始", side: "center-right"},
      {index: 4, label: "L", side: "left"}, {index: 5, label: "R", side: "right"},
    ]};
  }
  if (machine === "apple2p" || machine === "apple2e") {
    return {layout: "JOYSTICK", auxiliary: [
      {index: 2, label: "Space", side: "left"}, {index: 3, label: "Enter", side: "right"},
      {index: 8, label: "Esc", side: "center-left"}, {index: 9, label: "1", side: "center-right"},
    ]};
  }
  if (machine === "atom") {
    return {faces: [
      {index: 0, label: "空格", slot: "bottom"}, {index: 1, label: "回车", slot: "right"},
    ], auxiliary: [
      {index: 4, label: "Shift", side: "left"}, {index: 5, label: "REPT", side: "right"},
      {index: 8, label: "Esc", side: "center-left"},
    ]};
  }
  if (machine === "coleco") {
    return {...touchGamepadProfiles.twoButton, auxiliary: [
      {index: 8, label: "2", side: "center-left"}, {index: 9, label: "1", side: "center-right"},
    ]};
  }
  if (machine === "sg1000") {
    return {...touchGamepadProfiles.twoButton, auxiliary: [{index: 9, label: "暂停", side: "center-right"}]};
  }
  if (machine === "pv1000") {
    return {...touchGamepadProfiles.twoButton, auxiliary: [
      {index: 8, label: "Select", side: "center-left"}, {index: 9, label: "Start", side: "center-right"},
    ]};
  }
  return undefined;
}
