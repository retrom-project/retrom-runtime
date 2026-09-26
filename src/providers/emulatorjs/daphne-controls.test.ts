import {expect, it} from "vitest";
import {createRetromDefaultControls} from "./default-controls.js";

it("keeps Daphne coin and start distinct and puts Fazer on the bottom face button", () => {
  const controls = createRetromDefaultControls("daphne")[0];
  expect(controls[2].value2).toBe("SELECT");
  expect(controls[3].value2).toBe("START");
  expect(controls[0].value2).toBe("BUTTON_1");
  expect(controls[8].value2).toBe("BUTTON_2");
  expect(controls[7].value2).toBe("DPAD_RIGHT");
  const buttons = Object.values(controls).flatMap(control => control.value2 ? [control.value2] : []);
  expect(new Set(buttons).size).toBe(buttons.length);
});
