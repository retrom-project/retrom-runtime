import type {RuntimeContentFile} from "./types.js";
import {configurationFailure} from "./validation.js";

type ScriptEncoding = "gbk" | "sjis" | "utf8";

/** ScriptHandler::readScript opens the first existing script in this order; the number is its encrypt mode. */
const scripts = [["0.txt", 0], ["00.txt", 0], ["nscr_sec.dat", 2], ["nscript.dat", 1]] as const;
const magic = [0x79, 0x57, 0x0d, 0x80, 0x04];

export const onsScriptNames: readonly string[] = scripts.map(([name]) => name);
/** The host supplies at most this many leading bytes of each script as `prefixBase64` evidence. */
export const onsScriptSampleBytes = 1024 * 1024;

/** Detect the --enc value from the script the engine will actually read in the entry directory. */
export function onsScriptEncoding(files: readonly RuntimeContentFile[], entry: string,
  evidence: Readonly<Record<string, {prefixBase64?: string}>> | undefined): ScriptEncoding {
  const root = entry.slice(0, entry.lastIndexOf("/") + 1);
  for (const [name, mode] of scripts) {
    const key = root + name;
    const file = files.find(item => item.logicalKey === key);
    if (!file) {continue;}
    const sample = evidence?.[key]?.prefixBase64;
    if (typeof sample !== "string") {configurationFailure("RUNTIME_EVIDENCE_REQUIRED");}
    const bytes = Uint8Array.from(atob(sample), character => character.charCodeAt(0));
    if (bytes.length !== Math.min(file.sizeBytes, onsScriptSampleBytes)) {configurationFailure("RUNTIME_EVIDENCE_INVALID");}
    return detectEncoding(completeLines(decodeScript(bytes, mode), bytes.length < file.sizeBytes));
  }
  configurationFailure("RUNTIME_ENTRY_MISSING");
}

function decodeScript(bytes: Uint8Array, mode: 0 | 1 | 2) {
  if (mode === 0) {return bytes;}
  return bytes.map((byte, index) => mode === 1 ? byte ^ 0x84 : byte ^ magic[index % magic.length]!);
}

/** A truncated sample may end inside a multibyte character; newline is ASCII in every supported encoding. */
function completeLines(bytes: Uint8Array, truncated: boolean) {
  if (!truncated) {return bytes;}
  const end = bytes.lastIndexOf(0x0a);
  return end < 0 ? bytes : bytes.subarray(0, end + 1);
}

function detectEncoding(bytes: Uint8Array): ScriptEncoding {
  if (!bytes.some(byte => byte >= 0x80)) {return "utf8";}
  if (decoded("utf-8", bytes).errors === 0) {return "utf8";}
  const gbk = decoded("gbk", bytes), sjis = decoded("shift_jis", bytes);
  // Most Shift_JIS byte pairs are also valid GBK, so Japanese text is recognised by its kana.
  if (sjis.errors <= gbk.errors && sjis.kana * 20 >= sjis.wide) {return "sjis";}
  return gbk.errors <= sjis.errors ? "gbk" : "sjis";
}

function decoded(encoding: string, bytes: Uint8Array) {
  let errors = 0, kana = 0, wide = 0;
  for (const character of new TextDecoder(encoding).decode(bytes)) {
    const code = character.codePointAt(0)!;
    if (code === 0xfffd) {errors++;}
    else if (code >= 0x80) {
      wide++;
      if (code >= 0x3040 && code <= 0x30ff) {kana++;}
    }
  }
  return {errors, kana, wide};
}
