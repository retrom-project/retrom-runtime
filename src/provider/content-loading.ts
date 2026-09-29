import type {TargetDeclaration} from "./declarations.js";
import type {RuntimeContentLoadingV1} from "./module-api.js";

/** Publish consumer-facing behavior, keeping I/O bridges and limits private. */
export function contentLoadingCapability(target: TargetDeclaration): {contentLoading?: RuntimeContentLoadingV1} {
  switch (target.contentIO.game?.mode) {
    case "RANGE":
    case "ON_OPEN": return {contentLoading: "ON_DEMAND_AND_PRELOAD"};
    case "EAGER": return {contentLoading: "PRELOAD_ONLY"};
    default: return {};
  }
}
