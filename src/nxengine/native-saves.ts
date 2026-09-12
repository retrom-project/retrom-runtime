import {sha256} from "@noble/hashes/sha2.js";
import type {CheckpointAvailability, RuntimeCheckpoint} from "../contract.js";
import type {NXEngineCore} from "./core.js";
import {decodeSave, encodeSave, isSaveName, saveFormat, type SaveFile} from "./save.js";

export function nativeSaves(core: Pick<NXEngineCore, "FS">, identity: string, restore: Uint8Array | null) {
  const restored = restore ? decodeSave(restore, identity) : [];
  let baseline = restore ? signature(encodeSave(identity, restored)) : "";
  const current = () => {
    const files: SaveFile[] = core.FS.readdir("/save").filter(isSaveName).sort().map((name) => {
      if (core.FS.stat(`/save/${name}`).size !== 0x604) {throw new Error("NXENGINE_SAVE_INVALID");}
      return [name, core.FS.readFile(`/save/${name}`)];
    });
    return files.length ? encodeSave(identity, files) : null;
  };
  const availability = (): CheckpointAvailability => {
    const save = {dataKind: "PROGRESS", capture: "IN_GAME", restore: "IN_GAME", captureAvailable: false} as const;
    try {
      const bytes = current();
      if (!bytes) {return {available: false, blocker: "NO_SAVE", save};}
      const revision = signature(bytes);
      return baseline === revision ? {available: false, blocker: "UNCHANGED", save} : {available: true, blocker: null, revision, save};
    } catch {return {available: false, blocker: "FAILED", save};}
  };
  return {
    availability,
    importBeforeStart() {for (const [name, bytes] of restored) {core.FS.writeFile(`/save/${name}`, bytes);}},
    capture(): RuntimeCheckpoint {
      if (!availability().available) {throw new Error("NXENGINE_SAVE_UNAVAILABLE");}
      const bytes = current(); if (!bytes) {throw new Error("NXENGINE_SAVE_UNAVAILABLE");}
      return {format: saveFormat, bytes};
    },
    acknowledge(checkpoint: RuntimeCheckpoint) {
      if (checkpoint.format !== saveFormat) {throw new Error("NXENGINE_SAVE_INVALID");}
      baseline = signature(encodeSave(identity, decodeSave(checkpoint.bytes, identity)));
    },
  };
}
function signature(bytes: Uint8Array) {return [...sha256(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");}
