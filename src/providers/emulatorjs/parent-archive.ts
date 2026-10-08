import type {AdapterContentSession} from "../../provider/content-inputs.js";
import {fileContentSource, requireContentSession} from "../../provider/content-inputs.js";
import type {LaunchEnvelopeV1} from "../../provider/module-api.js";
import {checkSignal} from "../../content-io/abort.js";
import type {EjsInstance} from "./emulator-instance.js";
import {optionalResource} from "./resources.js";
import {contentFileName} from "./content-filename.js";

/** The pinned 4.3 File dispatch consults this policy before it decompresses content. */
export function preserveParentArchive(instance: EjsInstance, core: string): () => void {
  const parent = instance.downloadType?.parent;
  if (!parent || !core) {throw new Error("PLAYER_PARENT_ARCHIVE_UNAVAILABLE");}
  const previous = parent.dontExtractIfCore, own = [...new Set([...(previous ?? []), core])];
  parent.dontExtractIfCore = own;
  return () => {if (parent.dontExtractIfCore === own) {parent.dontExtractIfCore = previous;}};
}

/** 4.2's Parent downloader always decompresses, so mount the immutable archive directly. */
export function installParentArchiveDownload(instance: EjsInstance, envelope: LaunchEnvelopeV1,
  optionalSession: AdapterContentSession | null, signal: AbortSignal): () => void {
  const parent = optionalResource(envelope, "parent", "PARENT_ARCHIVE"), previous = instance.downloadGameParent;
  if (!parent || !previous || !instance.config) {throw new Error("PLAYER_PARENT_ARCHIVE_UNAVAILABLE");}
  const session = requireContentSession(optionalSession), policy = session.inputPolicy("parent"), name = contentFileName(parent.url);
  const download = async () => {
    checkSignal(signal);
    const write = instance.gameManager?.FS?.writeFile;
    if (!write || !instance.config) {throw new Error("PLAYER_PARENT_ARCHIVE_UNAVAILABLE");}
    const reader = await session.open(fileContentSource(parent, policy), policy, signal);
    try {
      const value = await session.materialize(reader.id, {kind: "BLOB", maxBytes: policy.maxFileBytes}, signal);
      if (value.kind !== "BLOB") {throw new Error("PLAYER_PARENT_ARCHIVE_UNAVAILABLE");}
      try {
        const bytes = new Uint8Array(await value.blob.arrayBuffer());
        checkSignal(signal);
        if (bytes.length !== parent.sizeBytes) {throw new Error("PLAYER_PARENT_ARCHIVE_UNAVAILABLE");}
        write.call(instance.gameManager!.FS, `/${name}`, bytes);
        instance.config.gameParentUrl = name;
      } finally {await value.release();}
    } finally {await reader.close();}
  };
  instance.downloadGameParent = download;
  return () => {if (instance.downloadGameParent === download) {instance.downloadGameParent = previous;}};
}
