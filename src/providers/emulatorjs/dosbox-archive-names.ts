import {zipNameCRC32} from "../../content-io/zip-name.js";

/** Native DOS has no Unicode namespace. Keep the UI's full paths separate from mounted 8.3 aliases. */
export function dosArchiveNames(names: readonly string[]): Map<string, string> {
  const reserved = new Map<string, Set<string>>(), aliases = new Map<string, string>();
  for (const name of names) {
    const parts = name.replace(/\/$/u, "").split("/");
    for (let index = 0; index < parts.length; index++) {
      const parent = parts.slice(0, index).join("/");
      const choices = reserved.get(parent) ?? new Set<string>();
      if (ascii(parts[index])) {choices.add(parts[index].toUpperCase());}
      reserved.set(parent, choices);
    }
  }
  const result = new Map<string, string>();
  for (const name of names) {
    const parts = name.replace(/\/$/u, "").split("/");
    const mounted = parts.map((part, index) => {
      if (ascii(part)) {return part;}
      const key = parts.slice(0, index + 1).join("/");
      const existing = aliases.get(key);
      if (existing) {return existing;}
      const directory = index < parts.length - 1 || name.endsWith("/");
      const extension = !directory ? /\.([a-z0-9]{1,3})$/iu.exec(part)?.[0].toUpperCase() ?? "" : "";
      const choices = reserved.get(parts.slice(0, index).join("/"))!;
      const hash = zipNameCRC32(new TextEncoder().encode(key));
      let candidate = "";
      for (let attempt = 0; attempt < 65536; attempt++) {
        candidate = (directory ? "D" : "F") + ((hash + attempt) & 0x0fffffff).toString(16).padStart(7, "0").toUpperCase() + extension;
        if (!choices.has(candidate)) {break;}
        if (attempt === 65535) {throw new Error("DOSBOX_ARCHIVE_INVALID");}
      }
      choices.add(candidate); aliases.set(key, candidate); return candidate;
    }).join("/");
    result.set(name, mounted + (name.endsWith("/") ? "/" : ""));
  }
  return result;
}
function ascii(value: string) {return /^[\x20-\x7e]+$/u.test(value);}
