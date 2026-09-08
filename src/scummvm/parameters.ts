export type ScummvmSelection = {
  engineId: string;
  gameId: string;
  root: string;
  language: string;
  platform: string;
  extra: string;
  guiOptions: string;
  filename: string | null;
};
export type ScummvmParameters = {
  contentDigest: string;
  projectIndexUrl: string;
  runtimeBaseUrl: string;
  selection: ScummvmSelection;
};

export function selectionConfig(selection: ScummvmSelection, resumeSlot: number | null) {
  if (!selection || !/^[a-z0-9_]+$/u.test(selection.engineId) || !/^[a-zA-Z0-9_-]+$/u.test(selection.gameId) ||
    typeof selection.root !== "string" || selection.root && !safePath(selection.root)) {throw invalid();}
  const values: Record<string, string> = {
    engineid: selection.engineId, gameid: selection.gameId, path: `/game${selection.root ? `/${selection.root}` : ""}`,
    language: selection.language, platform: selection.platform, extra: selection.extra, guioptions: selection.guiOptions,
    ...(selection.filename === null ? {} : {filename: selection.filename}),
  };
  if (Object.values(values).some((value) => typeof value !== "string" || value.length > 4096 || /[\r\n\0]/u.test(value))) {throw invalid();}
  if (resumeSlot !== null) {values.save_slot = String(resumeSlot);}
  return `[scummvm]\nsavepath=/saves\nextrapath=/data\nthemepath=/data\npluginspath=/plugins\nautosave_period=0\nconfirm_exit=false\nfullscreen=false\n\n[retrom-game]\n` +
    Object.entries(values).filter(([, value]) => value !== "").map(([key, value]) => `${key}=${value}\n`).join("");
}
function safePath(path: string) {return !/[\\\r\n\0]/u.test(path) && path.split("/").every((part) => Boolean(part) && part !== "." && part !== "..");}
function invalid() {return new Error("SCUMMVM_SELECTION_INVALID");}
