import {afterEach, expect, it, vi} from "vitest";
import {openEmulatorJsNativeSettings, closeEmulatorJsNativeSettings} from "./native-settings.js";
import {installEmulatorJsFrameStyle} from "./surface.js";

afterEach(() => {document.body.replaceChildren(); document.head.replaceChildren(); document.documentElement.className = "";});

it.each(["display", "core", "controls"] as const)("hides touch controls while %s owns interaction and restores them on close", (panel) => {
  const removeStyle = installEmulatorJsFrameStyle(document);
  const touch = document.createElement("div"); touch.className = "ejs_virtualGamepad_parent";
  const settingsMenu = document.createElement("div");
  settingsMenu.innerHTML = '<button class="ejs_settings_main_bar">Graphics Settings</button><button class="ejs_settings_main_bar">Backend Core Options</button>';
  const controlMenu = document.createElement("div");
  document.body.append(touch, settingsMenu, controlMenu);
  const instance = {settingsMenu, controlMenu, menu: {open: vi.fn(), close: vi.fn()}, closeSettingsMenu: vi.fn()};
  expect(openEmulatorJsNativeSettings(instance, panel, true)).toBe(true);
  expect(getComputedStyle(touch).display).toBe("none");
  closeEmulatorJsNativeSettings(instance);
  expect(getComputedStyle(touch).display).not.toBe("none");
  openEmulatorJsNativeSettings(instance, panel, true);
  removeStyle();
  expect(document.documentElement.classList.contains("retrom-native-panel-open")).toBe(false);
});

it("does not expose a partial native menu when the requested panel is absent", () => {
  const settingsMenu = document.createElement("div");
  const menu = {open: vi.fn(), close: vi.fn()};
  expect(openEmulatorJsNativeSettings({settingsMenu, menu}, "display")).toBe(false);
  expect(menu.open).not.toHaveBeenCalled();
  expect(document.documentElement.classList.contains("retrom-native-settings-open")).toBe(false);
});
