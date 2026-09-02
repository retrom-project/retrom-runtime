import type { ProviderDefinition } from "./declarations.js";

export type ProviderManifest = ReturnType<typeof projectProviderManifest>;

export function projectProviderManifest(definition: ProviderDefinition) {
  const adapters = new Map(definition.adapters.map((adapter) => [adapter.id, adapter]));
  const targets = definition.targets.map((target) => {
    const adapter = adapters.get(target.adapterId);
    if (!adapter) {throw new Error("PROVIDER_TARGET_ADAPTER_UNKNOWN");}
    const checkpoint = adapter.checkpoint === null || target.checkpointMaxBytes === null
      ? null
      : {
          maxBytes: target.checkpointMaxBytes,
          readFormats: sorted(adapter.checkpoint.readFormats),
          writeFormat: adapter.checkpoint.writeFormat,
        };
    if (adapter.capabilities.checkpoint !== (checkpoint !== null)) {
      throw new Error("PROVIDER_TARGET_CHECKPOINT_INVALID");
    }
    return {
      assetPaths: sorted(target.assetPaths),
      capabilities: {
        checkpoint: adapter.capabilities.checkpoint,
        discSwitch: target.discSwitch,
        frameCounter: adapter.capabilities.frameCounter,
        frameMode: target.frameMode,
        inputFilter: target.inputFilter,
        nativeSettings: target.nativeSettings,
        netplayPort: target.netplayPort,
        pause: adapter.capabilities.pause,
        requiresThreads: target.requiresThreads,
        screenshot: adapter.capabilities.screenshot,
        standardGamepad: adapter.capabilities.standardGamepad,
        validationProbes: sorted(adapter.capabilities.validationProbes),
        videoModes: sorted(target.videoModes),
        volume: adapter.capabilities.volume,
      },
      checkpoint,
      displayName: target.displayName,
      gameCompatibilityLine: target.gameCompatibilityLine,
      id: target.id,
      inputs: target.inputs.map((input) => ({...input})),
      netplayCompatibilityLine: target.netplayCompatibilityLine,
      optionsKind: target.optionsKind,
    };
  }).sort((left, right) => compareUtf8(left.id, right.id));
  return {
    clientModulePath: "client.mjs" as const,
    providerApiVersion: definition.providerApiVersion,
    providerId: definition.providerId,
    providerVersion: definition.providerVersion,
    schemaVersion: 1 as const,
    targets,
  };
}

function sorted<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort(compareUtf8);
}

function compareUtf8(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftBytes[index] - rightBytes[index];
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
