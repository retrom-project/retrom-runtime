import type {LaunchEnvelopeV1, RuntimeHostV1} from "./module-api.js";
import {decodeStoredCheckpoint} from "./checkpoint-storage.js";
import type {StartupTasks} from "./startup.js";

export function loadStartupRestore(envelope: LaunchEnvelopeV1, host: RuntimeHostV1, startup: StartupTasks): Promise<Uint8Array | null> {
  const load = async () => {
    const bytes = await host.loadRestore(envelope.restore);
    return bytes && envelope.restore ? decodeStoredCheckpoint(bytes, envelope.restore.format,
      envelope.runtime.checkpoint?.maxBytes ?? 0, host.signal) : bytes;
  };
  return envelope.restore ? startup.run("RESTORE_LOAD", load) : load();
}
