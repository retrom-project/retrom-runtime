export type TouchGamepadLayout = "STANDARD" | "PSP" | "POINTER" | "JOYSTICK";
type Face = {index: number; label: string; slot: "bottom" | "right" | "left" | "top"};
type Auxiliary = {index: number; label: string; side: "center-left" | "center-right" | "left" | "right"};
export type TouchGamepadLayoutOptions = {layout?: TouchGamepadLayout; faces?: readonly Face[]; auxiliary?: readonly Auxiliary[]};
export type TouchGamepadOptions = TouchGamepadLayoutOptions & {enabled?: boolean};
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
} as const satisfies Record<string, TouchGamepadLayoutOptions>;

export function touchGamepadLayout(layout: TouchGamepadLayout = "STANDARD", controls: TouchGamepadLayoutOptions = {}) {
  const faces = layout === "PSP" ? standardFaces.map((face, index) => ({...face, label: ["×", "○", "□", "△"][index]}))
    : layout === "POINTER" ? [{...standardFaces[0], label: "确认"}, {...standardFaces[1], label: "返回"}]
      : layout === "JOYSTICK" ? standardFaces.slice(0, 2) : standardFaces;
  const auxiliary = layout === "PSP" ? [...menuButtons, ...shoulderButtons] : layout === "JOYSTICK" ? menuButtons : [];
  return {faces: controls.faces ?? faces, auxiliary: controls.auxiliary ?? auxiliary, analog: layout === "PSP" || layout === "JOYSTICK"};
}

export const touchGamepadStyle = `
[data-retrom-touch-gamepad]{position:fixed;inset:0;pointer-events:none;z-index:2147483646;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;font-family:system-ui,sans-serif}
[data-retrom-touch-gamepad][hidden]{display:none}
[data-retrom-touch-gamepad] [data-control]{position:absolute;pointer-events:auto;touch-action:none;box-sizing:border-box;
  border:2px solid rgba(255,255,255,.55);background:rgba(20,22,30,.35);color:rgba(255,255,255,.85);
  display:flex;align-items:center;justify-content:center;opacity:.7;padding:0}
[data-retrom-touch-gamepad] [data-control="dpad"],
[data-retrom-touch-gamepad] [data-control="analog"]{--size:clamp(100px,30vmin,160px);width:var(--size);height:var(--size);
  left:max(20px,env(safe-area-inset-left));bottom:max(20px,env(safe-area-inset-bottom));border-radius:50%}
[data-retrom-touch-gamepad] [data-control="analog"]{left:calc(max(20px,env(safe-area-inset-left)) + clamp(100px,30vmin,160px) + 16px)}
[data-retrom-touch-gamepad][data-layout="JOYSTICK"] [data-control="dpad"]{display:none}
[data-retrom-touch-gamepad][data-layout="JOYSTICK"] [data-control="analog"]{left:max(20px,env(safe-area-inset-left))}
[data-retrom-touch-gamepad] [data-knob]{width:50%;height:50%;border-radius:50%;
  transform:translate(var(--stick-x,0px),var(--stick-y,0px));pointer-events:none;background:rgba(255,0,0,.5)}
[data-retrom-touch-gamepad] [data-face]{--size:clamp(44px,12vmin,64px);--gap:calc(var(--size) * .95);width:var(--size);height:var(--size);
  border-radius:50%;font-size:calc(var(--size) * .38);font-weight:600;
  right:calc(max(20px,env(safe-area-inset-right)) + var(--gap));bottom:calc(max(20px,env(safe-area-inset-bottom)) + var(--gap))}
[data-retrom-touch-gamepad] [data-face="bottom"]{transform:translateY(var(--gap))}
[data-retrom-touch-gamepad] [data-face="right"]{transform:translateX(var(--gap))}
[data-retrom-touch-gamepad] [data-face="left"]{transform:translateX(calc(var(--gap) * -1))}
[data-retrom-touch-gamepad] [data-face="top"]{transform:translateY(calc(var(--gap) * -1))}
[data-retrom-touch-gamepad] [data-side]{min-width:52px;min-height:36px;border-radius:8px;font-size:14px;
  bottom:max(20px,env(safe-area-inset-bottom))}
[data-retrom-touch-gamepad] [data-side="center-left"]{right:calc(50% + 6px)}
[data-retrom-touch-gamepad] [data-side="center-right"]{left:calc(50% + 6px)}
[data-retrom-touch-gamepad] [data-side="left"],
[data-retrom-touch-gamepad] [data-side="right"]{bottom:calc(max(20px,env(safe-area-inset-bottom)) + clamp(100px,30vmin,160px) + 16px)}
[data-retrom-touch-gamepad] [data-side="left"]{left:max(20px,env(safe-area-inset-left))}
[data-retrom-touch-gamepad] [data-side="right"]{right:max(20px,env(safe-area-inset-right))}
[data-retrom-touch-gamepad] [data-control][data-active]{background:rgba(255,255,255,.4);color:#fff;opacity:.95}
[data-retrom-touch-gamepad] [data-control="dpad"],
[data-retrom-touch-gamepad] [data-control="analog"]{border:0;background:rgba(255,0,0,.5);opacity:.5}
[data-retrom-touch-gamepad] [data-control="dpad"][data-active],
[data-retrom-touch-gamepad] [data-control="analog"][data-active]{background:rgba(255,0,0,.5);opacity:1}
@media(max-width:639px){
 [data-retrom-touch-gamepad][data-layout="PSP"] [data-control="analog"]{left:max(20px,env(safe-area-inset-left));
  bottom:calc(max(20px,env(safe-area-inset-bottom)) + clamp(100px,30vmin,160px) + 58px)}
}
`;
