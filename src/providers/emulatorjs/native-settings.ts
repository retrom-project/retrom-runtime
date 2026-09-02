export type EmulatorNativeSettingsInstance = {
  menu?: {close?: () => void; open?: (force?: boolean) => void};
  controlMenu?: HTMLElement;
  settingsMenu?: HTMLElement;
  settingsMenuOpen?: boolean;
  closeSettingsMenu?: () => void;
};

type NativeSettingsPanel = "controls" | "display" | "core";

const panelMatchers: Record<Exclude<NativeSettingsPanel, "controls">, RegExp> = {
  display: /graphics settings|display settings|图形设置|图像设置|显示设置/iu,
  core: /backend core options|core options|核心选项|核心设置/iu,
};

function hideControlPanel(instance: EmulatorNativeSettingsInstance) {
  if (instance.controlMenu) {instance.controlMenu.style.display = "none";}
}

function setNativeSettingsVisibility(instance: EmulatorNativeSettingsInstance, visible: boolean) {
  const frameDocument = instance.settingsMenu?.ownerDocument ?? instance.controlMenu?.ownerDocument;
  frameDocument?.documentElement.classList.toggle("retrom-native-settings-open", visible);
}

function resetNativeSettingsNavigation(instance: EmulatorNativeSettingsInstance) {
  const transition = instance.settingsMenu?.querySelector<HTMLElement>(".ejs_settings_transition");
  if (!transition) {return instance.settingsMenu ?? null;}
  const children = [...transition.querySelectorAll<HTMLElement>(":scope > *")];
  const home = children.find((child) => child.classList.contains("ejs_setting_menu"));
  if (!home) {return instance.settingsMenu ?? null;}
  for (const child of children) {
    if (child === home) {child.removeAttribute("hidden");}
    else {child.setAttribute("hidden", "");}
  }
  return home;
}

export function openEmulatorJsNativeSettings(
  instance: EmulatorNativeSettingsInstance,
  panel: NativeSettingsPanel,
) {
  if (panel === "controls") {
    setNativeSettingsVisibility(instance, false);
    instance.closeSettingsMenu?.();
    instance.menu?.close?.();
    if (!instance.controlMenu) {return false;}
    instance.controlMenu.style.display = "";
    return true;
  }

  hideControlPanel(instance);
  if (!instance.settingsMenu) {return false;}
  setNativeSettingsVisibility(instance, true);
  instance.menu?.open?.(true);
  instance.settingsMenuOpen = true;
  instance.settingsMenu.style.display = "";
  const navigationRoot = resetNativeSettingsNavigation(instance);
  const target = [...(navigationRoot?.querySelectorAll<HTMLElement>(".ejs_settings_main_bar") ?? [])]
    .find((entry) => panelMatchers[panel].test(entry.textContent ?? ""));
  if (!target) {return false;}
  target.click();
  return true;
}

export function closeEmulatorJsNativeSettings(instance: EmulatorNativeSettingsInstance) {
  hideControlPanel(instance);
  setNativeSettingsVisibility(instance, false);
  instance.closeSettingsMenu?.();
  instance.menu?.close?.();
}
