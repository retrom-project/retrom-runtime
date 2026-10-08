const buttons = [
  "FIRE", "SOFT_RIGHT", "SOFT_LEFT", "DIGIT_1", "DIGIT_3", "DIGIT_7", "DIGIT_9", "DIGIT_0",
  "SOFT_RIGHT", "SOFT_LEFT", "STAR", "POUND", "UP", "DOWN", "LEFT", "RIGHT",
] as const;
export type J2meGamepadAction = typeof buttons[number];

function actions(pad: Gamepad | undefined): Set<J2meGamepadAction> {
  const desired = new Set<J2meGamepadAction>();
  if (!pad) {return desired;}
  buttons.forEach((action, index) => {
    if (pad.buttons[index]?.pressed || pad.buttons[index]?.value >= .5) {desired.add(action);}
  });
  if (pad.axes[0] <= -.55) {desired.add("LEFT");}
  if (pad.axes[0] >= .55) {desired.add("RIGHT");}
  if (pad.axes[1] <= -.55) {desired.add("UP");}
  if (pad.axes[1] >= .55) {desired.add("DOWN");}
  return desired;
}

/** The Provider owns this frame's gamepad mapping; the core still owns its physical keyboard. */
export function installJ2meGamepad(
  realm: Window,
  setInput: (action: J2meGamepadAction, pressed: boolean) => void,
  active: () => boolean,
) {
  const navigator = realm.navigator;
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "getGamepads");
  if (descriptor && !descriptor.configurable || typeof navigator.getGamepads !== "function") {
    throw new Error("J2ME_INPUT_UNAVAILABLE");
  }
  // Capture the already-installed Host filter, including menu suppression and reserved chords.
  const source = navigator.getGamepads.bind(navigator);
  const coreGamepads = () => [];
  Object.defineProperty(navigator, "getGamepads", {configurable: true,
    enumerable: descriptor?.enumerable ?? false, writable: true, value: coreGamepads});
  const held = new Set<J2meGamepadAction>();
  let paused = true, stopped = false, frame = 0;
  function update(desired: Set<J2meGamepadAction>) {
    for (const action of held) {
      if (!desired.has(action)) {setInput(action, false); held.delete(action);}
    }
    for (const action of desired) {
      if (!held.has(action)) {setInput(action, true); held.add(action);}
    }
  }
  const release = () => update(new Set());
  const hidden = () => {if (realm.document.hidden) {release();}};
  const tick = () => {
    if (stopped) {return;}
    const pad = !paused && active() && realm.document.hasFocus() && !realm.document.hidden
      ? Array.from(source()).find(pad => pad?.connected && pad.mapping === "standard") ?? undefined : undefined;
    update(actions(pad));
    frame = realm.requestAnimationFrame(tick);
  };
  realm.addEventListener("blur", release);
  realm.document.addEventListener("visibilitychange", hidden);
  frame = realm.requestAnimationFrame(tick);
  return {
    pause() {paused = true; release();},
    resume() {paused = false;},
    dispose() {
      if (stopped) {return;}
      stopped = true; realm.cancelAnimationFrame(frame);
      realm.removeEventListener("blur", release); realm.document.removeEventListener("visibilitychange", hidden);
      try {release();}
      finally {
        if (navigator.getGamepads === coreGamepads) {
          if (descriptor) {Object.defineProperty(navigator, "getGamepads", descriptor);}
          else {Reflect.deleteProperty(navigator, "getGamepads");}
        }
      }
    },
  };
}
