import {RuntimeFailureError} from "../provider/failure.js";
import type {OpenBOR} from "./module.js";

export function openBORFailure(core: OpenBOR | undefined, code: "OPENBOR_CORE_EXITED" | "OPENBOR_CORE_ABORTED", cause?: unknown) {
  const lines = readFailureLog(core).split(/\r?\n/u);
  const firstFailure = lines.findIndex(line => /Can't find openbor constant|Script compile error|Script error:|Fatal Error|Can't compile script|Failed to parse script/iu.test(line));
  const log = lines.slice(firstFailure >= 0 ? firstFailure : 0).join("\n");
  // These are explicit native parser/compiler rejections. Other exits remain
  // unknown engine failures; a nonzero exit alone does not prove bad content.
  const content = code === "OPENBOR_CORE_EXITED" && /Script compile error|Can't compile script|Failed to parse script|Delay must fit/iu.test(log);
  return new RuntimeFailureError(code, content ? "CONTENT" : "CORE", log.match(/[\s\S]{1,500}/gu) ?? [], {cause});
}

function readFailureLog(core: OpenBOR | undefined): string {
  try {
    if (core && core.FS.stat("/Logs/OpenBorLog.txt").size <= 4 * 1024 * 1024) {
      return new TextDecoder().decode(core.FS.readFile("/Logs/OpenBorLog.txt")).slice(-4000);
    }
  } catch { /* A failure before log initialization has no native log. */ }
  return "";
}
