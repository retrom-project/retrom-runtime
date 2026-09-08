const identities = {
  vice_xvic: {repository: "https://github.com/retrom-project/vice-libretro", baseline: "g1b4309f4d56d", license: "COPYING"},
  virtualjaguar: {repository: "https://github.com/retrom-project/virtualjaguar-libretro", baseline: "3.6.1", license: "LICENSE"},
};

export function forkReleaseFiles(catalog) {
  const forks = catalog.forks ?? [];
  if (!Array.isArray(forks) || new Set(forks.map((fork) => fork.runtimeCore)).size !== forks.length) {invalid();}
  return forks.flatMap((fork) => {
    const identity = identities[fork.runtimeCore];
    if (!identity || fork.repository !== identity.repository || !/^[0-9a-f]{40}$/u.test(fork.commit) ||
      fork.adapterAbi !== "emulatorjs-state-v1" ||
      !new RegExp(`^retrom-core-${identity.baseline.replaceAll(".", "\\.")}-r[1-9][0-9]*(-rc\\.[1-9][0-9]*)?$`, "u")
        .test(fork.tag)) {invalid();}
    const expected = [
      [`${fork.runtimeCore}-wasm.data`, `4.2.3/data/cores/${fork.runtimeCore}-wasm.data`],
      ["rpg-runtime-release.json", `4.2.3/data/cores/reports/${fork.runtimeCore}.json`],
      [identity.license, `4.2.3/licenses/forks/${fork.runtimeCore}/${identity.license}`],
    ];
    if (!Array.isArray(fork.assets) || fork.assets.length !== expected.length) {invalid();}
    return expected.map(([filename, destination]) => {
      const asset = fork.assets.find((entry) => entry.filename === filename);
      if (!asset || !/^[0-9a-f]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.sizeBytes) ||
        asset.sizeBytes < 1 || asset.url !== `${fork.repository}/releases/download/${fork.tag}/${filename}`) {invalid();}
      return {...asset, destination, runtimeCore: fork.runtimeCore};
    });
  });
}

export function verifyForkMetadata(fork, metadata) {
  if (metadata.repository !== fork.repository || metadata.commit !== fork.commit || metadata.tag !== fork.tag ||
    metadata.adapterAbi !== fork.adapterAbi || metadata.schemaVersion !== 1 || !Array.isArray(metadata.assets)) {invalid();}
  const assets = fork.assets.filter((asset) => asset.filename !== "rpg-runtime-release.json");
  if (metadata.assets.length !== assets.length) {invalid();}
  for (const asset of assets) {
    const described = metadata.assets.find((entry) => entry.filename === asset.filename);
    if (described?.observedSha256 !== asset.sha256 || described.sizeBytes !== asset.sizeBytes) {invalid();}
  }
}

function invalid() {throw new Error("EMULATORJS_FORK_RELEASE_INVALID");}
