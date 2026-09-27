export type AcceptanceTarget = {providerId: string; targetId: string; mode: string;
  delivery: string | null; gameKind: string; checkpointSemantics: string};
export function targetCatalog(): Promise<{schemaVersion: 1; targets: AcceptanceTarget[]}>;
