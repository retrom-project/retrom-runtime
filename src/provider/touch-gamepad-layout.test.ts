import {describe, expect, it} from "vitest";
import {touchGamepadStyle} from "./touch-gamepad-layout.js";

function rule(selector: string) {
  const start = touchGamepadStyle.indexOf(`${selector}{`);
  if (start < 0) {throw new Error(`missing ${selector}`);}
  return touchGamepadStyle.slice(start + selector.length + 1, touchGamepadStyle.indexOf("}", start)).replace(/\s+/gu, "");
}

describe("touch gamepad geometry", () => {
  it("matches the EmulatorJS frame anchors instead of hugging the bottom edge", () => {
    const root = rule("[data-retrom-touch-gamepad]");
    expect(root).toContain("--left:max(10px,env(safe-area-inset-left))");
    expect(root).toContain("--right:max(10px,env(safe-area-inset-right))");
    expect(root).toContain("--base:max(70px,calc(env(safe-area-inset-bottom)+20px))");
    expect(root).toContain("--stick:125px");
  });

  it("centres a 100px stick in a 125px touch zone, 72.5px from the side and 132.5px above the bottom", () => {
    const stick = rule(`[data-retrom-touch-gamepad] [data-control="analog"]`);
    expect(stick).toContain("width:var(--stick);height:var(--stick)");
    expect(stick).toContain("left:var(--left);bottom:var(--base)");
    expect(touchGamepadStyle.replace(/\s+/gu, "")).toContain("background:radial-gradient(circle,rgba(255,0,0,.5)050px,transparent50px)");
    expect(rule("[data-retrom-touch-gamepad] [data-knob]")).toContain("width:50px;height:50px");
  });

  it("places 50px face buttons on a 40px diamond centred 75px from the side and 135px above the bottom", () => {
    const face = rule("[data-retrom-touch-gamepad] [data-face]");
    expect(face).toContain("--size:50px;--gap:40px");
    expect(face).toContain("right:calc(var(--right)+var(--gap))");
    expect(face).toContain("bottom:calc(var(--base)+var(--gap))");
  });

  it("arranges a two-button pad like the EmulatorJS two-button layout", () => {
    expect(rule(`[data-retrom-touch-gamepad]:not(:has([data-face="left"],[data-face="top"])) [data-face="bottom"]`))
      .toBe("transform:translate(-30px,30px)");
  });

  it("keeps menu buttons 60px and shoulder buttons 255px above the bottom", () => {
    expect(rule("[data-retrom-touch-gamepad] [data-side]")).toContain("bottom:calc(var(--base)-10px)");
    expect(rule(`[data-retrom-touch-gamepad] [data-side="right"]`)).toContain("bottom:calc(var(--base)+185px)");
  });
});
