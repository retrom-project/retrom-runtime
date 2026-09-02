export type ResourceKind =
  | "ROM_BLOB_V1"
  | "FILE_TREE_V1"
  | "SEEKABLE_BLOB_V1"
  | "NATIVE_WEB_V1"
  | "ISOLATED_WEB_V1"
  | "BIOS_BUNDLE_V1"
  | "PARENT_ARCHIVE_V1"
  | "MULTI_DISC_V1"
  | "EXTERNAL_FILE_SET_V1"
  | "WASM4_CART_V1";

export type OptionsKind =
  | "NONE_V1"
  | "EMULATORJS_V1"
  | "RPGMAKER_V1"
  | "ONS_PROJECT_V1"
  | "KIRIKIRI_PROJECT_V1";

export type FrameMode =
  | "NONE"
  | "SAME_ORIGIN_BLANK"
  | "SAME_ORIGIN_RESOURCE"
  | "ISOLATED_ORIGIN_RESOURCE";

export type VideoMode = "original" | "pixel" | "smooth" | "sharp-bilinear" | "adaptive-sharpen";

export type ProviderCapabilities = {
  pause: boolean;
  screenshot: boolean;
  checkpoint: boolean;
  standardGamepad: boolean;
  frameCounter: boolean;
  volume: boolean;
  validationProbes: readonly string[];
};

export type AdapterDeclaration = {
  id: string;
  kind: string;
  abi: string;
  checkpoint: {
    writeFormat: string;
    readFormats: readonly string[];
  } | null;
  capabilities: ProviderCapabilities;
};

export type TargetInputDeclaration = {
  role: string;
  kind: ResourceKind;
  cardinality: "ONE" | "MANY";
  optional: boolean;
};

export type TargetDeclaration = {
  id: string;
  displayName: string;
  gameCompatibilityLine: string;
  netplayCompatibilityLine: string | null;
  adapterId: string;
  optionsKind: OptionsKind;
  requiresThreads: boolean;
  frameMode: FrameMode;
  discSwitch: boolean;
  nativeSettings: boolean;
  inputFilter: boolean;
  netplayPort: boolean;
  videoModes: readonly VideoMode[];
  inputs: readonly TargetInputDeclaration[];
  checkpointMaxBytes: number | null;
  assetPaths: readonly string[];
  implementation: Readonly<Record<string, unknown>>;
};

export type ProviderDefinition = {
  providerId: string;
  providerVersion: string;
  providerApiVersion: 1;
  adapters: readonly AdapterDeclaration[];
  targets: readonly TargetDeclaration[];
};

export function defineAdapter<const Definition extends AdapterDeclaration>(definition: Definition): Definition {
  return definition;
}

export function defineTarget<const Definition extends TargetDeclaration>(definition: Definition): Definition {
  return definition;
}

export function defineProvider<const Definition extends ProviderDefinition>(definition: Definition): Definition {
  const adapterIds = new Set(definition.adapters.map((adapter) => adapter.id));
  if (adapterIds.size !== definition.adapters.length) {throw new Error("PROVIDER_ADAPTER_DUPLICATE");}
  const targetIds = new Set(definition.targets.map((target) => target.id));
  if (targetIds.size !== definition.targets.length) {throw new Error("PROVIDER_TARGET_DUPLICATE");}
  for (const target of definition.targets) {
    if (!adapterIds.has(target.adapterId)) {throw new Error("PROVIDER_TARGET_ADAPTER_UNKNOWN");}
  }
  return definition;
}
