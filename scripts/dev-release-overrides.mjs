import { isAbsolute } from "node:path";

export function parseDevReleaseOverrides(raw, releases) {
  if (raw === undefined || raw === "") {return new Map();}
  let value;
  try {value = JSON.parse(raw);}
  catch {throw new Error("DEV_RELEASE_OVERRIDES_INVALID");}
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("DEV_RELEASE_OVERRIDES_INVALID");
  }
  const allowed = new Set(releases.map((release) => release.id));
  const overrides = new Map();
  for (const [id, directory] of Object.entries(value)) {
    if (!allowed.has(id) || typeof directory !== "string" || !isAbsolute(directory)) {
      throw new Error("DEV_RELEASE_OVERRIDES_INVALID");
    }
    overrides.set(id, directory);
  }
  return overrides;
}
