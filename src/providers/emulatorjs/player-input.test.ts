import {afterEach, expect, it, vi} from "vitest";
import {launchEnvelope} from "../../../tests/emulatorjs-provider-fixtures.js";
import type {RuntimeStateV1} from "../../provider/module-api.js";
import {EmulatorPlayerInput} from "./player-input.js";

afterEach(() => document.body.replaceChildren());
it("retains pre-mount policy while respecting readiness, settings, suppression and teardown", () => {
  let state: RuntimeStateV1 = "CREATED";
  const emit = vi.fn(), abort = new AbortController();
  const input = new EmulatorPlayerInput(launchEnvelope(), abort.signal, () => state, emit);
  input.setHostShortcutPolicy({menu:"KeyM",pause:false});
  const frame = document.createElement("iframe"); document.body.append(frame);
  const target = frame.contentWindow!;
  Object.defineProperty(target.navigator,"getGamepads",{configurable:true,value:()=>[]});
  input.bind(target);
  const key = () => {const event = new KeyboardEvent("keydown",{code:"KeyM",key:"m",cancelable:true});target.dispatchEvent(event);return event;};
  expect(key().defaultPrevented).toBe(false);
  state = "RUNNING"; expect(key().defaultPrevented).toBe(true);
  expect(emit).toHaveBeenCalledExactlyOnceWith({type:"HOST_SHORTCUT",shortcut:"MENU"});
  target.document.documentElement.classList.add("retrom-native-panel-open");
  expect(key().defaultPrevented).toBe(false);
  target.document.documentElement.classList.remove("retrom-native-panel-open");
  input.setInputFilter({activeGamepadIndex:null,suppressInput:true});expect(key().defaultPrevented).toBe(false);
  input.setInputFilter(null);expect(key().defaultPrevented).toBe(true);
  expect(emit).toHaveBeenCalledTimes(2);
  input.stop();expect(key().defaultPrevented).toBe(false);
  abort.abort();expect(()=>input.setHostShortcutPolicy({menu:"KeyM",pause:false})).toThrow("PLAYER_RUNTIME_CONTRACT_INVALID");
});
