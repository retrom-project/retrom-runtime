function record(value: unknown): Record<string, unknown> | null {
 return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
 return Object.keys(value).sort().join("\0") === keys.sort().join("\0");
}
function asset(value: unknown, paths: readonly string[]): boolean {
 const item = record(value);
 return Boolean(item && exact(item, ["path", "sha256"]) && typeof item.path === "string" && paths.includes(item.path) &&
  typeof item.sha256 === "string" && /^[a-f0-9]{64}$/u.test(item.sha256));
}
export function validContentRequirements(value: unknown, paths: readonly string[]): boolean {
 const rule = record(value);
 if (!rule) {return false;}
 if (rule.kind === "DECRYPTED_NCSD_NCCH") {return exact(rule, ["kind"]);}
 return exact(rule, ["kind", "platform", "catalog", "core"]) && rule.kind === "FLYCAST_CARTRIDGE" &&
  typeof rule.platform === "string" && ["naomi", "naomi2", "atomiswave"].includes(rule.platform) && asset(rule.catalog, paths) && asset(rule.core, paths);
}
export function validArcadeDAT(value: unknown, paths: readonly string[]): boolean {
 const dat = record(value);
 return Boolean(dat && exact(dat, ["format", "asset", "core", "provenance"]) && dat.format === "ARCADE_XML" &&
  asset(dat.asset, paths) && asset(dat.core, paths) && asset(dat.provenance, paths));
}
