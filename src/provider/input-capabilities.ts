import type {ProviderDefinition} from "./declarations.js";
import type {RuntimeInputCapabilitiesV1} from "./module-api.js";

export function providerInputCapabilities(definition: ProviderDefinition, targetId: string): RuntimeInputCapabilitiesV1 {
  const target = definition.targets.find(entry => entry.id === targetId);
  if (!target) {throw new Error("PROVIDER_TARGET_UNKNOWN");}
  return {hostShortcuts: [...target.hostKeyboardShortcuts]};
}
