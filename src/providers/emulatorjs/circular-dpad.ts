// Keep EmulatorJS's directional events and mappings; only follow the finger visually.
// Delegation also covers pads created later by either pinned EmulatorJS release.
export function installCircularDpadFeedback(frameDocument: Document) {
  const active = new Set<HTMLElement>();
  const clear = (pad: HTMLElement) => {
    pad.style.removeProperty("--retrom-stick-x");
    pad.style.removeProperty("--retrom-stick-y");
    active.delete(pad);
  };
  const update = (event: TouchEvent) => {
    const target = event.target;
    if (!target || !("closest" in target)) {return;}
    const pad = (target as Element).closest<HTMLElement>(".ejs_dpad_main");
    if (!pad) {return;}
    const touch = event.targetTouches[0];
    if (!touch || event.type === "touchend" || event.type === "touchcancel") {clear(pad); return;}
    const bounds = pad.getBoundingClientRect();
    const x = touch.clientX - bounds.left - bounds.width / 2;
    const y = touch.clientY - bounds.top - bounds.height / 2;
    const radius = Math.min(50, bounds.width / 2, bounds.height / 2);
    const scale = Math.min(1, radius / (Math.hypot(x, y) || 1));
    pad.style.setProperty("--retrom-stick-x", `${x * scale}px`);
    pad.style.setProperty("--retrom-stick-y", `${y * scale}px`);
    active.add(pad);
  };
  const events = ["touchstart", "touchmove", "touchend", "touchcancel"] as const;
  for (const event of events) {frameDocument.addEventListener(event, update, {capture: true, passive: true});}
  return () => {
    for (const event of events) {frameDocument.removeEventListener(event, update, true);}
    for (const pad of active) {clear(pad);}
  };
}

export const circularDpadStyle = `
.ejs_dpad_main{border-radius:50%;opacity:.5}
.ejs_dpad_main>.ejs_dpad_vertical,.ejs_dpad_main>.ejs_dpad_horizontal{display:none}
.ejs_dpad_main::before,.ejs_dpad_main::after{content:"";position:absolute;border-radius:50%;background:rgba(255,0,0,.5);pointer-events:none}
.ejs_dpad_main::before{width:100px;height:100px;left:calc(50% - 50px);top:calc(50% - 50px)}
.ejs_dpad_main::after{width:50px;height:50px;left:calc(50% - 25px);top:calc(50% - 25px);transform:translate(var(--retrom-stick-x,0px),var(--retrom-stick-y,0px))}
.ejs_dpad_main[class*="_pressed"]{opacity:1}
`;
