import {createHash} from "node:crypto";

/** Save identity covers declared core bytes, independently of the runtime build. */
export async function fingerprintProvider(definition, assetIndex) {
  const result = {};
  for (const target of definition.targets) {
    if (!definition.adapters.some(adapter => adapter.id === target.adapterId) ||
      !Array.isArray(target.coreAssetPaths) || new Set(target.coreAssetPaths).size !== target.coreAssetPaths.length) {
      throw new Error("RUNTIME_IMPLEMENTATION_INVALID");
    }
    const inputs = target.coreAssetPaths.map(path => {
      const identity = assetIndex[path];
      if (!target.assetPaths.includes(path) || !identity || !/^[a-f0-9]{64}$/u.test(identity.sha256)) {
        throw new Error(`RUNTIME_IMPLEMENTATION_ASSET_MISSING:${path}`);
      }
      return {kind: "ASSET", path, sha256: identity.sha256};
    }).sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
    // Paths describe packaging, not compatibility. Keep them only as diagnostic inputs.
    // Game-supplied engines explicitly declare no packaged core; romHash covers their bytes.
    const identity = {providerId: definition.providerId, targetId: target.id,
      coreSha256: inputs.map(input => input.sha256).sort()};
    result[target.id] = {fingerprint: createHash("sha256").update(JSON.stringify(identity)).digest("hex"), inputs};
  }
  return result;
}
