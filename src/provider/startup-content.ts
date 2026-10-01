import type {ContentSourceV1} from "../../contracts/content-io/v1/content-io.js";
import type {ContentSessionAccess} from "./content-inputs.js";
import type {StartupTasks} from "./startup.js";

/** Observe preparation promises without changing transport, caching or Reader lifetime. */
export function startupContent(session: ContentSessionAccess, tasks: StartupTasks): ContentSessionAccess {
  const sources = new Map<string, ContentSourceV1>();
  return {
    preloaded: session.preloaded,
    async open(source, policy, signal) {
      if (!tasks.active) {sources.clear(); return session.open(source, policy, signal);}
      const open = async () => {
        const reader = await session.open(source, policy, signal);
        if (tasks.active) {sources.set(reader.id, source);}
        return reader;
      };
      return policy.mode === "EAGER" ? open() : tasks.run(contentKind(source), open);
    },
    async materialize(id, request, signal, report) {
      if (!tasks.active) {sources.clear(); return session.materialize(id, request, signal, report);}
      const source = sources.get(id);
      if (!source) {return session.materialize(id, request, signal, report);}
      return tasks.run(contentKind(source), task => session.materialize(id, request, signal, progress => {
        task.progress(progress.readyBytes, progress.totalBytes);
        report?.(progress);
      }));
    },
    async closeFile(id) {sources.delete(id); await session.closeFile(id);},
  };
}

function contentKind(source: ContentSourceV1) {
  return source.purpose === "CORE_ASSET" ? "CORE_ASSETS" : source.purpose === "FIRMWARE" ? "BIOS" : "GAME_CONTENT";
}
