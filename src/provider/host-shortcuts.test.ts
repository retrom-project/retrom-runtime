import {afterEach, expect, it, vi} from "vitest";
import {RuntimeHostShortcuts} from "./host-shortcuts.js";

const cleanups: Array<() => void> = [];
afterEach(() => {for (const clean of cleanups.splice(0)) {clean();} document.body.replaceChildren();});
function setup(allowed: ("MENU" | "PAUSE")[] = ["MENU", "PAUSE"]) {
  const report = vi.fn();
  const shortcuts = new RuntimeHostShortcuts(allowed, report, () => true);
  shortcuts.bind(window);
  cleanups.push(() => shortcuts.stop());
  return {shortcuts, report};
}
function key(code: string, options: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", {key: code === "KeyM" ? "m" : code, code, bubbles: true, cancelable: true, ...options});
  target.dispatchEvent(event); return event;
}
it("configures the menu key explicitly and forwards pause only when enabled", () => {
  const {shortcuts, report} = setup();
  shortcuts.setPolicy({menu: "Escape", pause: true});
  expect(key("KeyM").defaultPrevented).toBe(false);
  expect(key("Escape").defaultPrevented).toBe(true);
  expect(report).toHaveBeenLastCalledWith("MENU");
  key("KeyP"); expect(report).toHaveBeenLastCalledWith("PAUSE");
  shortcuts.setPolicy({menu: "KeyM", pause: false});
  expect(key("Escape").defaultPrevented).toBe(false);
  expect(key("KeyP").defaultPrevented).toBe(false);
  expect(key("KeyM").defaultPrevented).toBe(true);
  expect(report.mock.calls.map(([value]) => value)).toEqual(["MENU", "PAUSE", "MENU"]);
});
it.each([{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true}])("leaves modified or composing keys with the game: %j", (options) => {
  const {shortcuts, report} = setup(); shortcuts.setPolicy({menu:"KeyM",pause:true});
  expect(key("KeyM", options).defaultPrevented).toBe(false); expect(report).not.toHaveBeenCalled();
});
it.each(["input", "textarea", "select", "div"]) ("leaves editable %s controls alone", (tag) => {
  const {shortcuts, report} = setup(); shortcuts.setPolicy({menu:"KeyM",pause:true});
  const node = document.createElement(tag); if (tag === "div") {node.setAttribute("contenteditable", "true");}
  document.body.append(node); expect(key("KeyM", {}, node).defaultPrevented).toBe(false); expect(report).not.toHaveBeenCalled();
});
it("stops capture under suppression, null policy and teardown; blur allows a fresh press", () => {
  const {shortcuts, report} = setup(); shortcuts.setPolicy({menu:"KeyM",pause:false});
  key("KeyM"); key("KeyM"); expect(report).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("blur")); key("KeyM"); expect(report).toHaveBeenCalledTimes(2);
  shortcuts.setSuppressed(true); expect(key("KeyM").defaultPrevented).toBe(false);
  shortcuts.setSuppressed(false); key("KeyM"); expect(report).toHaveBeenCalledTimes(3);
  shortcuts.setPolicy(null); expect(key("KeyM").defaultPrevented).toBe(false);
  shortcuts.setPolicy({menu:"KeyM",pause:false}); shortcuts.stop();
  expect(key("KeyM").defaultPrevented).toBe(false); expect(report).toHaveBeenCalledTimes(3);
});
it("rejects unsupported bindings and drops stale bridge notifications after suppression", () => {
  const {shortcuts, report} = setup(["MENU"]);
  expect(() => shortcuts.setPolicy({menu:"Escape",pause:true})).toThrow("PLAYER_HOST_SHORTCUT_POLICY_INVALID");
  shortcuts.setPolicy({menu:"Escape",pause:false}); shortcuts.receive("PAUSE"); expect(report).not.toHaveBeenCalled();
  shortcuts.receive("MENU"); expect(report).toHaveBeenCalledOnce();
  shortcuts.setSuppressed(true); shortcuts.receive("MENU"); expect(report).toHaveBeenCalledOnce();
});

it("consumes reserved repeats without repeating the Host action or leaking a held key to the game", () => {
  const {shortcuts, report} = setup(); shortcuts.setPolicy({menu:"KeyM",pause:true});
  const game = vi.fn(); window.addEventListener("keydown", game);
  cleanups.push(() => window.removeEventListener("keydown", game));
  expect(key("KeyM").defaultPrevented).toBe(true);
  expect(key("KeyM", {repeat:true}).defaultPrevented).toBe(true);
  expect(report).toHaveBeenCalledOnce(); expect(game).not.toHaveBeenCalled();
  window.dispatchEvent(new KeyboardEvent("keyup", {code:"KeyM",cancelable:true}));
  key("KeyM"); expect(report).toHaveBeenCalledTimes(2);
  expect(key("KeyZ", {repeat:true}).defaultPrevented).toBe(false);
  expect(key("KeyM", {repeat:true,ctrlKey:true}).defaultPrevented).toBe(false);
  expect(game).toHaveBeenCalledTimes(2);
});
