import bindings from "./bindings.json" with {type: "json"};
import platforms from "./platforms.json" with {type: "json"};
import coreNames from "./core-names.json" with {type: "json"};
import {emulatorJsProviderDefinition} from "../providers/emulatorjs/catalog.js";
import {retromRuntimeProviderDefinition} from "../providers/retrom-runtime/catalog.js";
import {projectProviderManifest} from "../provider/manifest.js";
import type {ProviderDefinition, TargetDeclaration} from "../provider/declarations.js";
import type {RuntimeContent} from "./types.js";
import {configurationFailure} from "./validation.js";

export const runtimeProviders: readonly ProviderDefinition[] = [emulatorJsProviderDefinition, retromRuntimeProviderDefinition];
export type RuntimeBinding = {coreId: string; providerId: string; targetId: string; platformIds: string[];
  contentKinds: string[]; engine?: string};
export const runtimeBindings: readonly RuntimeBinding[] = bindings;
export const runtimePlatforms: readonly {id: string; displayName: string}[] = platforms;

export function runtimeCatalog(providerVersion?: string) {
  const cores = coreNames.map(core => ({...core, platformIds: [...new Set(runtimeBindings.filter(binding => binding.coreId === core.id)
    .flatMap(binding => binding.platformIds))].sort()}));
  return {providers: runtimeProviders.map(provider => projectProviderManifest(providerVersion ? {...provider, providerVersion} : provider)),
    bindings: runtimeBindings, platforms: runtimePlatforms, cores};
}

export function resolveRuntimeTarget(platformId: string, coreId: string, content: RuntimeContent):
  {binding: RuntimeBinding; provider: ProviderDefinition; target: TargetDeclaration} {
  const matches = runtimeBindings.filter(binding => binding.coreId === coreId && binding.platformIds.includes(platformId) &&
    binding.contentKinds.includes(content.kind) && (!binding.engine || content.kind === "RPG_MAKER_PROJECT" && binding.engine === content.engine));
  if (matches.length !== 1) {configurationFailure("RUNTIME_CORE_UNAVAILABLE", {coreId, platformId});}
  const binding = matches[0], provider = runtimeProviders.find(item => item.providerId === binding.providerId);
  const target = provider?.targets.find(item => item.id === binding.targetId);
  if (!provider || !target) {configurationFailure("RUNTIME_DECLARATION_INVALID");}
  return {binding, provider, target};
}

export function validateRuntimeCatalog(): void {
  for (const binding of runtimeBindings) {
    const provider = runtimeProviders.find(item => item.providerId === binding.providerId);
    if (!provider?.targets.some(target => target.id === binding.targetId)) {configurationFailure("RUNTIME_DECLARATION_INVALID");}
  }
}
