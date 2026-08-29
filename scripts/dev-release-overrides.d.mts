export type RuntimeReleaseIdentity = { id: string };

export function parseDevReleaseOverrides(
  raw: string | undefined,
  releases: RuntimeReleaseIdentity[],
): Map<string, string>;
