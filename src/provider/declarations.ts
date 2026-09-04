export type ResourceKind =
  | "ROM_BLOB"
  | "FILE_TREE"
  | "SEEKABLE_BLOB"
  | "NATIVE_WEB"
  | "ISOLATED_WEB"
  | "BIOS_BUNDLE"
  | "PARENT_ARCHIVE"
  | "MULTI_DISC"
  | "EXTERNAL_FILE_SET"
  | "WASM4_CART";

export type TargetOptionsType = "array" | "boolean" | "integer" | "object" | "string";
export type TargetOptionsTypeDeclaration<Type extends TargetOptionsType> =
  | Type
  | readonly [Type, "null"];

export type TargetOptionsStringSchema = Readonly<{
  type: TargetOptionsTypeDeclaration<"string">;
  enum?: readonly string[];
  format?: "safe-path";
  minLength?: number;
  maxLength?: number;
}>;

export type TargetOptionsIntegerSchema = Readonly<{
  type: TargetOptionsTypeDeclaration<"integer">;
  minimum?: number;
  maximum?: number;
}>;

export type TargetOptionsBooleanSchema = Readonly<{
  type: TargetOptionsTypeDeclaration<"boolean">;
}>;

export type TargetOptionsArraySchema = Readonly<{
  type: TargetOptionsTypeDeclaration<"array">;
  items: TargetOptionsPropertySchema;
  minItems?: number;
  maxItems: number;
}>;

export type TargetOptionsObjectSchema = Readonly<{
  type: TargetOptionsTypeDeclaration<"object">;
  additionalProperties: false;
  properties: Readonly<Record<string, TargetOptionsPropertySchema>>;
  required: readonly string[];
}>;

export type TargetOptionsPropertySchema =
  | TargetOptionsStringSchema
  | TargetOptionsIntegerSchema
  | TargetOptionsBooleanSchema
  | TargetOptionsArraySchema
  | TargetOptionsObjectSchema;

export type TargetOptionsSchema = TargetOptionsObjectSchema & Readonly<{type: "object"}>;

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
  adapterId: string;
  targetOptionsSchema: TargetOptionsSchema;
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
