import {expect, it} from "vitest";
import {createRetromDefaultControls} from "./default-controls.js";

it("maps the bottom gamepad button to PUAE joystick fire and CD32 red", () => {
  const controls = createRetromDefaultControls("puae")[0];
  expect(controls[0].value2).toBe("BUTTON_1");
  expect(controls[8].value2).toBe("BUTTON_2");
  expect(controls[7].value2).toBe("DPAD_RIGHT");
  const buttons = Object.values(controls).flatMap(control => control.value2 ? [control.value2] : []);
  expect(new Set(buttons).size).toBe(buttons.length);
});
