import type {J2meInputAction} from "./input.js";

const keys: readonly (readonly [J2meInputAction, string])[] = [
  ["SOFT_LEFT", "左软键"], ["FIRE", "确认"], ["SOFT_RIGHT", "右软键"],
  ["DIGIT_1", "1"], ["DIGIT_2", "2"], ["DIGIT_3", "3"],
  ["DIGIT_4", "4"], ["DIGIT_5", "5"], ["DIGIT_6", "6"],
  ["DIGIT_7", "7"], ["DIGIT_8", "8"], ["DIGIT_9", "9"],
  ["STAR", "*"], ["DIGIT_0", "0"], ["POUND", "#"],
];
const arrows = {ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT"} as const;
const styleText = `
.j2me-touch-layout{--j2me-control-height:44px;--j2me-control-gap:8px;--j2me-control-radius:6px;
 --j2me-control-font:14px;--j2me-control-caption:12px;--j2me-control-weight:600;
 --j2me-control-surface:#191f2e;--j2me-control-ink:#edf0f7;--j2me-control-line:#46516a;
 --j2me-control-active:#7861df;--j2me-control-focus:#c0afff;
 box-sizing:border-box;display:grid;grid-template-columns:140px minmax(0,1fr) 172px;gap:16px;
 height:100%;width:100%;align-items:center;padding:16px max(8px,env(safe-area-inset-right)) 16px max(8px,env(safe-area-inset-left));
 font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--j2me-control-ink)}
.j2me-touch-screen{grid-column:2;grid-row:1;min-width:0;min-height:0;height:100%;width:100%;overflow:hidden}
.j2me-touch-stick{grid-column:1;grid-row:1;position:relative;justify-self:center;box-sizing:border-box;
 width:132px;height:132px;border:1px solid var(--j2me-control-line);border-radius:50%;background:var(--j2me-control-surface)}
.j2me-touch-stick::before{content:"";position:absolute;inset:18px;border:1px solid var(--j2me-control-line);border-radius:50%;opacity:.5}
.j2me-touch-knob{position:absolute;left:50%;top:50%;width:60px;height:60px;box-sizing:border-box;
 border:1px solid var(--j2me-control-line);border-radius:50%;background:var(--j2me-control-surface);
 transform:translate(calc(-50% + var(--j2me-stick-x,0px)),calc(-50% + var(--j2me-stick-y,0px)))}
.j2me-touch-knob::after{content:"";position:absolute;inset:22px;border:1px solid var(--j2me-control-line);border-radius:50%}
.j2me-touch-stick[aria-pressed=true] .j2me-touch-knob{border-color:var(--j2me-control-focus)}
.j2me-touch-keypad{grid-column:3;grid-row:1;display:grid;grid-template-columns:repeat(3,minmax(44px,1fr));gap:var(--j2me-control-gap)}
.j2me-touch-layout button{touch-action:none;user-select:none;-webkit-user-select:none;padding:0;color:inherit;font:inherit}
.j2me-touch-layout .j2me-touch-key{height:var(--j2me-control-height);min-width:44px;box-sizing:border-box;border:1px solid var(--j2me-control-line);
 border-radius:var(--j2me-control-radius);background:var(--j2me-control-surface);font-size:var(--j2me-control-font);font-weight:var(--j2me-control-weight)}
.j2me-touch-layout .j2me-touch-key[data-j2me-action^=SOFT_]{font-size:var(--j2me-control-caption)}
.j2me-touch-key[data-j2me-action=FIRE]{border-color:var(--j2me-control-focus)}
.j2me-touch-key[aria-pressed=true]{background:var(--j2me-control-active)}
.j2me-touch-layout button:focus-visible{outline:2px solid var(--j2me-control-focus);outline-offset:2px}
.j2me-touch-layout button:disabled{opacity:.5}
@media(orientation:portrait){
 .j2me-touch-layout{grid-template-columns:132px minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto;gap:12px 8px;
  padding:8px max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left))}
 .j2me-touch-screen{grid-column:1/-1;grid-row:1}
 .j2me-touch-stick{grid-column:1;grid-row:2}
 .j2me-touch-keypad{grid-column:2;grid-row:2;justify-self:end;width:min(100%,188px);gap:4px}
}
@media(max-height:320px) and (orientation:landscape){.j2me-touch-layout{padding-block:8px;gap:8px;--j2me-control-gap:4px}}
`;

type ReplaceInput = (source: string, actions: Iterable<J2meInputAction>) => void;

export function installJ2meTouchControls(target: HTMLElement, realm: Window, replace: ReplaceInput, focus: () => void) {
  if (!realm.matchMedia?.("(any-pointer: coarse)").matches) {return null;}
  const document = target.ownerDocument;
  const style = document.createElement("style"); style.textContent = styleText;
  const root = document.createElement("div"); root.className = "j2me-touch-layout";
  const screen = document.createElement("div"); screen.className = "j2me-touch-screen";
  const stick = document.createElement("button"); stick.type = "button"; stick.className = "j2me-touch-stick";
  stick.setAttribute("aria-label", "方向摇杆"); stick.setAttribute("aria-pressed", "false");
  const knob = document.createElement("span"); knob.className = "j2me-touch-knob"; knob.setAttribute("aria-hidden", "true"); stick.append(knob);
  const keypad = document.createElement("div"); keypad.className = "j2me-touch-keypad"; keypad.setAttribute("aria-label", "手机键盘");
  for (const [action, label] of keys) {
    const button = document.createElement("button"); button.type = "button"; button.className = "j2me-touch-key";
    button.dataset.j2meAction = action; button.textContent = label; button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", "false"); keypad.append(button);
  }
  root.append(stick, screen, keypad); document.head.append(style); target.append(root);
  const sources = new Map<string, Set<J2meInputAction>>();
  let enabled = false, disposed = false, stickPointer: number | null = null;
  const position = (x = 0, y = 0) => {
    stick.style.setProperty("--j2me-stick-x", `${x}px`); stick.style.setProperty("--j2me-stick-y", `${y}px`);
  };
  function update(source: string, actions: Iterable<J2meInputAction>) {
    const next = new Set(actions);
    if (next.size) {sources.set(source, next);} else {sources.delete(source);}
    replace(source, next);
    const held = new Set([...sources.values()].flatMap(value => [...value]));
    for (const key of keypad.querySelectorAll<HTMLButtonElement>("[data-j2me-action]")) {
      key.setAttribute("aria-pressed", String(held.has(key.dataset.j2meAction as J2meInputAction)));
    }
    stick.setAttribute("aria-pressed", String(["UP", "DOWN", "LEFT", "RIGHT"].some(action => held.has(action as J2meInputAction))));
  }
  const releaseAll = () => {
    for (const source of [...sources.keys()]) {update(source, []);}
    stickPointer = null; position();
  };
  function moveStick(event: PointerEvent) {
    const bounds = stick.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2, y = event.clientY - bounds.top - bounds.height / 2;
    const distance = Math.hypot(x, y), travel = Math.max(0, (bounds.width - 60) / 2 - 8);
    const scale = distance > travel ? travel / distance : 1;
    position(x * scale, y * scale);
    const actions: J2meInputAction[] = [];
    if (distance > 8) {
      if (Math.abs(x) / distance >= .3827) {actions.push(x > 0 ? "RIGHT" : "LEFT");}
      if (Math.abs(y) / distance >= .3827) {actions.push(y > 0 ? "DOWN" : "UP");}
    }
    update(`touch:${event.pointerId}`, actions);
  }
  const pointerDown = (event: PointerEvent) => {
    if (!enabled || disposed || document.hidden || event.button !== 0) {return;}
    const element = event.target as Element;
    const key = element.closest<HTMLButtonElement>("[data-j2me-action]");
    if (stick.contains(element)) {
      if (stickPointer !== null) {return;}
      event.preventDefault(); focus(); stickPointer = event.pointerId; stick.setPointerCapture?.(event.pointerId); moveStick(event);
    } else if (key && keypad.contains(key)) {
      event.preventDefault(); focus(); key.setPointerCapture?.(event.pointerId);
      update(`touch:${event.pointerId}`, [key.dataset.j2meAction as J2meInputAction]);
    }
  };
  const pointerMove = (event: PointerEvent) => {
    if (enabled && !disposed && event.pointerId === stickPointer) {event.preventDefault(); moveStick(event);}
  };
  const pointerUp = (event: PointerEvent) => {
    update(`touch:${event.pointerId}`, []);
    if (event.pointerId === stickPointer) {stickPointer = null; position();}
  };
  const keyboard = (event: KeyboardEvent) => {
    const action = arrows[event.key as keyof typeof arrows];
    if (!action || !enabled || disposed) {return;}
    event.preventDefault(); event.stopPropagation();
    update(`touch:keyboard:${event.key}`, event.type === "keydown" ? [action] : []);
  };
  const hidden = () => {if (document.hidden) {releaseAll();}};
  const contextMenu = (event: Event) => event.preventDefault();
  root.addEventListener("pointerdown", pointerDown);
  root.addEventListener("pointermove", pointerMove);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {root.addEventListener(type, pointerUp as EventListener);}
  root.addEventListener("contextmenu", contextMenu);
  stick.addEventListener("keydown", keyboard); stick.addEventListener("keyup", keyboard);
  stick.addEventListener("blur", releaseAll);
  realm.addEventListener("blur", releaseAll); document.addEventListener("visibilitychange", hidden);
  function setEnabled(value: boolean) {
    enabled = value && !disposed;
    if (!enabled) {releaseAll();}
    for (const button of root.querySelectorAll("button")) {button.disabled = !enabled;}
  }
  setEnabled(false);
  return {
    target: screen,
    setEnabled,
    dispose() {
      if (disposed) {return;}
      setEnabled(false); disposed = true;
      root.removeEventListener("pointerdown", pointerDown); root.removeEventListener("pointermove", pointerMove);
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {root.removeEventListener(type, pointerUp as EventListener);}
      root.removeEventListener("contextmenu", contextMenu);
      stick.removeEventListener("keydown", keyboard); stick.removeEventListener("keyup", keyboard); stick.removeEventListener("blur", releaseAll);
      realm.removeEventListener("blur", releaseAll); document.removeEventListener("visibilitychange", hidden);
      root.remove(); style.remove();
    },
  };
}
