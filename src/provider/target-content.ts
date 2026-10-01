import type {ContentSessionClient} from "../content-io/client.js";
import {ContentIOError} from "../content-io/errors.js";
import type {TargetDeclaration} from "./declarations.js";
import type {AdapterContentSession, ContentSessionAccess} from "./content-inputs.js";
import {startupContent} from "./startup-content.js";
import type {StartupTasks} from "./startup.js";

type Policies = Pick<TargetDeclaration, "contentIO" | "contentMembers">;
export function bindTargetContent(session: ContentSessionClient, target: Policies, startup?: StartupTasks): AdapterContentSession & Pick<ContentSessionClient, "createSyncChannel">;
export function bindTargetContent(session: ContentSessionAccess, target: Policies, startup?: StartupTasks): AdapterContentSession;
/** A Target owns its policies. The Provider retains ownership of the underlying session. */
export function bindTargetContent(session: ContentSessionAccess, target: Policies, startup?: StartupTasks): AdapterContentSession {
  const observed = startup ? startupContent(session, startup) : session;
  return {
    preloaded: session.preloaded,
    open: (...args) => observed.open(...args), materialize: (...args) => observed.materialize(...args), closeFile: (...args) => observed.closeFile(...args),
    ...("createSyncChannel" in session && typeof session.createSyncChannel === "function" ? {createSyncChannel: session.createSyncChannel.bind(session)} : {}),
    inputPolicy(role, member) {
      const policy = member ? target.contentMembers?.[role]?.[member] : target.contentIO[role];
      if (!policy || !("bridge" in policy)) {throw new ContentIOError("SOURCE_INVALID");}
      return policy;
    },
  };
}

export function bindOptionalTargetContent(session: ContentSessionClient | null, target: Policies, startup?: StartupTasks) {
  return session ? bindTargetContent(session, target, startup) : null;
}
