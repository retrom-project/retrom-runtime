export type TouchGamepadLayout = "STANDARD" | "PSP" | "POINTER" | "JOYSTICK";
type Face = {index: number; label: string; slot: "bottom" | "right" | "left" | "top"};
type Auxiliary = {index: number; label: string; side: "center-left" | "center-right" | "left" | "right"};
export type TouchGamepadLayoutOptions = {layout?: TouchGamepadLayout; faces?: readonly Face[]; auxiliary?: readonly Auxiliary[]};
export type TouchStickMode = "FIXED" | "FLOATING";
export type TouchGamepadOptions = TouchGamepadLayoutOptions & {
  enabled?: boolean;
  /** FLOATING (default) centres the stick on the touch-down point instead of reading from its resting centre. */
  stickMode?: TouchStickMode;
  /**
   * A floating stick also accepts touches anywhere in the lower-left zone. Games that read touches on their own
   * surface keep the zone to the stick itself so the pad never covers their pointer input. Defaults to non-POINTER layouts.
   */
  wideStickZone?: boolean;
};
const standardFaces: Face[] = [
  {index: 0, label: "A", slot: "bottom"}, {index: 1, label: "B", slot: "right"},
  {index: 2, label: "X", slot: "left"}, {index: 3, label: "Y", slot: "top"},
];
const menuButtons: Auxiliary[] = [
  {index: 8, label: "Select", side: "center-left"}, {index: 9, label: "Start", side: "center-right"},
];
const shoulderButtons: Auxiliary[] = [{index: 4, label: "L", side: "left"}, {index: 5, label: "R", side: "right"}];

/** Data-only profiles reuse the same rendering, pointer ownership and standard input state. */
export const touchGamepadProfiles = {
  twoButton: {layout: "STANDARD", faces: standardFaces.slice(0, 2)},
  twoButtonMenu: {layout: "STANDARD", faces: standardFaces.slice(0, 2),
    auxiliary: [{index: 9, label: "菜单", side: "center-right"}]},
  action: {layout: "STANDARD", auxiliary: [...menuButtons, ...shoulderButtons]},
  analogMenu: {layout: "JOYSTICK", auxiliary: [],
    faces: [{index: 0, label: "确认", slot: "bottom"}, {index: 1, label: "菜单", slot: "right"}]},
  mini: {layout: "STANDARD", faces: [...standardFaces.slice(0, 2), {index: 2, label: "C", slot: "left"}],
    auxiliary: [{index: 4, label: "摇动", side: "left"}, {index: 8, label: "电源", side: "center-left"}]},
} as const satisfies Record<string, TouchGamepadLayoutOptions>;

export function touchGamepadLayout(layout: TouchGamepadLayout = "STANDARD", controls: TouchGamepadLayoutOptions = {}) {
  const faces = layout === "PSP" ? standardFaces.map((face, index) => ({...face, label: ["×", "○", "□", "△"][index]}))
    : layout === "POINTER" ? [{...standardFaces[0], label: "确认"}, {...standardFaces[1], label: "返回"}]
      : layout === "JOYSTICK" ? standardFaces.slice(0, 2) : standardFaces;
  const auxiliary = layout === "PSP" ? [...menuButtons, ...shoulderButtons] : layout === "JOYSTICK" ? menuButtons : [];
  return {faces: controls.faces ?? faces, auxiliary: controls.auxiliary ?? auxiliary, analog: layout === "PSP" || layout === "JOYSTICK"};
}

// Geometry mirrors the EmulatorJS provider frame so a player finds the stick and face buttons in the same place on
// every core: a 100px stick inside a 125px touch zone, centred 72.5px from the side and 132.5px from the bottom, 50px face buttons on a 40px
// diamond centred 75px from the side and 135px from the bottom, menu buttons 60px and shoulders 255px above the bottom.
// A two-button pad uses the EmulatorJS two-button arrangement: the lower button sits down-left of the right one.
export const touchGamepadStyle = `
[data-retrom-touch-gamepad]{position:fixed;inset:0;pointer-events:none;z-index:2147483646;
  --left:max(10px,env(safe-area-inset-left));--right:max(10px,env(safe-area-inset-right));
  --base:max(70px,calc(env(safe-area-inset-bottom) + 20px));--stick:125px;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;font-family:system-ui,sans-serif}
[data-retrom-touch-gamepad][hidden]{display:none}
[data-retrom-touch-gamepad] [data-control]{position:absolute;pointer-events:auto;touch-action:none;box-sizing:border-box;
  border:2px solid rgba(255,255,255,.55);background:rgba(20,22,30,.35);color:rgba(255,255,255,.85);
  display:flex;align-items:center;justify-content:center;opacity:.7;padding:0}
[data-retrom-touch-gamepad] [data-control="dpad"],
[data-retrom-touch-gamepad] [data-control="analog"]{width:var(--stick);height:var(--stick);
  left:var(--left);bottom:var(--base);border-radius:50%;translate:var(--float-x,0px) var(--float-y,0px)}
/* The floating zone sits beneath every control and stops short of the centre menu buttons. */
[data-retrom-touch-gamepad] [data-control="stick-zone"]{left:0;bottom:0;width:min(40%,calc(50% - 64px));height:65%;
  border:0;background:none;opacity:0}
[data-retrom-touch-gamepad] [data-control="analog"]{left:calc(var(--left) + var(--stick))}
[data-retrom-touch-gamepad][data-layout="JOYSTICK"] [data-control="dpad"]{display:none}
[data-retrom-touch-gamepad][data-layout="JOYSTICK"] [data-control="analog"]{left:var(--left)}
[data-retrom-touch-gamepad] [data-knob]{width:50px;height:50px;border-radius:50%;
  transform:translate(var(--stick-x,0px),var(--stick-y,0px));pointer-events:none;background:rgba(255,0,0,.5)}
[data-retrom-touch-gamepad] [data-face]{--size:50px;--gap:40px;width:var(--size);height:var(--size);
  border-radius:50%;font-size:calc(var(--size) * .38);font-weight:600;
  right:calc(var(--right) + var(--gap));bottom:calc(var(--base) + var(--gap))}
[data-retrom-touch-gamepad] [data-face="bottom"]{transform:translateY(var(--gap))}
[data-retrom-touch-gamepad] [data-face="right"]{transform:translateX(var(--gap))}
[data-retrom-touch-gamepad] [data-face="left"]{transform:translateX(calc(var(--gap) * -1))}
[data-retrom-touch-gamepad] [data-face="top"]{transform:translateY(calc(var(--gap) * -1))}
[data-retrom-touch-gamepad]:not(:has([data-face="left"],[data-face="top"])) [data-face="bottom"]{transform:translate(-30px,30px)}
[data-retrom-touch-gamepad] [data-side]{min-width:52px;min-height:36px;border-radius:8px;font-size:14px;
  bottom:calc(var(--base) - 10px)}
[data-retrom-touch-gamepad] [data-side="center-left"]{right:calc(50% + 6px)}
[data-retrom-touch-gamepad] [data-side="center-right"]{left:calc(50% + 6px)}
[data-retrom-touch-gamepad] [data-side="left"],
[data-retrom-touch-gamepad] [data-side="right"]{bottom:calc(var(--base) + 185px)}
[data-retrom-touch-gamepad] [data-side="left"]{left:calc(var(--left) + 3px)}
[data-retrom-touch-gamepad] [data-side="right"]{right:calc(var(--right) + 3px)}
[data-retrom-touch-gamepad] [data-control][data-active]{background:rgba(255,255,255,.4);color:#fff;opacity:.95}
[data-retrom-touch-gamepad] [data-control="dpad"],
[data-retrom-touch-gamepad] [data-control="analog"]{border:0;opacity:.5;
  background:radial-gradient(circle,rgba(255,0,0,.5) 0 50px,transparent 50px)}
[data-retrom-touch-gamepad] [data-control="dpad"][data-active],
[data-retrom-touch-gamepad] [data-control="analog"][data-active]{opacity:1}
@media(max-width:639px){
 [data-retrom-touch-gamepad][data-layout="PSP"] [data-control="analog"]{left:var(--left);
  bottom:calc(var(--base) + 227px)}
}
`;
