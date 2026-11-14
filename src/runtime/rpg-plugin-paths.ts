/** Desktop MV packages can place plugin scenario scripts next to their www directory. */
export function rpgPluginProjectRoot(entry: string) {
  return entry.slice(0, entry.lastIndexOf("/") + 1).replace(/www\/$/iu, "");
}
export function rpgPluginScenarioPath(entry: string, path: string): string | null {
  const root = rpgPluginProjectRoot(entry);
  return path.startsWith(`${root}scenario/`) && /\.(sl|txt)$/iu.test(path) ? path.slice(root.length) : null;
}

/** Small data files synchronously consumed by desktop-style MV/MZ plugins. */
export function isRpgPluginTextPath(path: string) {
  return /\.csv$/iu.test(path) || /^(?:scenario\/.+\.(?:sl|txt)|js\/plugins\/.+\.(?:talk|txt|json))$/iu.test(path);
}

export function rpgPluginTextPath(entry: string, path: string): string | null {
  const scenario = rpgPluginScenarioPath(entry, path);
  if (scenario !== null) {return scenario;}
  const root = entry.slice(0, entry.lastIndexOf("/") + 1);
  const relative = path.slice(root.length);
  return path.startsWith(root) && isRpgPluginTextPath(relative) ? relative : null;
}
