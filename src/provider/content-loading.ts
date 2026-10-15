import type {TargetDeclaration} from "./declarations.js";
import type {RuntimeContentLoadingV1} from "./module-api.js";

/** Publish consumer-facing behavior, keeping I/O bridges and limits private. */
export function contentLoadingCapability(target: TargetDeclaration): {contentLoading?: RuntimeContentLoadingV1} {
  if (Object.values(target.contentIO).some(policy => policy.mode === "RANGE" || policy.mode === "ON_OPEN")) {
    return {contentLoading: "ON_DEMAND_AND_PRELOAD"};
  }
  return target.contentIO.game?.mode === "EAGER" ? {contentLoading: "PRELOAD_ONLY"} : {};
}
