/** Desktop MV packages can place plugin scenario scripts next to their www directory. */
export function rpgPluginProjectRoot(entry: string) {
  return entry.slice(0, entry.lastIndexOf("/") + 1).replace(/www\/$/iu, "");
}
export function rpgPluginScenarioPath(entry: string, path: string): string | null {
  const root = rpgPluginProjectRoot(entry);
  return path.startsWith(`${root}scenario/`) && /\.(sl|txt)$/iu.test(path) ? path.slice(root.length) : null;
}
