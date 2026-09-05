import type {LaunchEnvelopeV1, RuntimeResourceV1} from "../../provider/module-api.js";

type ResourceOfKind<Kind extends RuntimeResourceV1["kind"]> = RuntimeResourceV1 & {kind: Kind};

export function externalFiles(envelope: LaunchEnvelopeV1) {
  const files = optionalResource(envelope, "external", "EXTERNAL_FILE_SET")?.files ?? [];
  const result: Record<string, string> = {};
  for (const file of files) {result[file.virtualPath] = file.url;}
  const discs = optionalResource(envelope, "discs", "MULTI_DISC");
  for (const entry of discs?.entries ?? []) {
    result[`/disc-${String(entry.index + 1).padStart(3, "0")}.chd`] = entry.url;
  }
  return result;
}

export function biosFile(resourceValue: ResourceOfKind<"BIOS_BUNDLE"> | null) {
  if (!resourceValue) {return undefined;}
  const bundle = resourceValue.files.find((entry) => entry.logicalName === "bundle.zip") ?? resourceValue.files[0];
  if (!bundle) {invalid();}
  return bundle.url;
}

export function runtimeBase(envelope: LaunchEnvelopeV1, release: string) {
  return `${envelope.runtime.runtimeBaseUrl}assets/${release}/data/`;
}

export function resource<Role extends string, Kind extends RuntimeResourceV1["kind"]>(
  envelope: LaunchEnvelopeV1,
  role: Role,
  kind: Kind,
): ResourceOfKind<Kind> {
  const value = optionalResource(envelope, role, kind);
  if (!value) {invalid();}
  return value;
}

export function optionalResource<Role extends string, Kind extends RuntimeResourceV1["kind"]>(
  envelope: LaunchEnvelopeV1,
  role: Role,
  kind: Kind,
): ResourceOfKind<Kind> | null {
  const value = envelope.resources.find((entry) => entry.role === role);
  if (!value) {return null;}
  if (value.kind !== kind) {invalid();}
  return value as ResourceOfKind<Kind>;
}

export function fileName(path: string) {return path.slice(path.lastIndexOf("/") + 1);}
function invalid(): never {throw new Error("PROVIDER_LAUNCH_REQUEST_INVALID");}
