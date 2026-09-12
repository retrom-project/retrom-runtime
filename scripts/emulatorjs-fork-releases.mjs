const identities = {
  uzem: {repository: "https://github.com/retrom-project/libretro-uzem", baseline: "gd991ee94547c", license: "LICENSE", source: "source.tar.gz"},
  bsnes: {repository: "https://github.com/retrom-project/bsnes-libretro", baseline: "g4b344745e387", license: "LICENSE.txt", source: "source.tar.gz", release: "4.3.0-pre"},
  neocd: {repository: "https://github.com/retrom-project/neocd_libretro", baseline: "g3118c6901787", license: "LICENSE.md", source: "source.tar.gz"},
  quasi88: {repository: "https://github.com/retrom-project/quasi88-libretro", baseline: "g459bbc6e90ca", license: "LICENSE", source: "source.tar.gz"},
  vecx: {repository: "https://github.com/retrom-project/libretro-vecx", baseline: "g8f671cc9d737", license: "LICENSE.md", source: "source.tar.gz"},
  "81": {repository: "https://github.com/retrom-project/81-libretro", baseline: "g86decf3ee61e", license: "LICENSE", source: "source.tar.gz"},
  cap32: {repository: "https://github.com/retrom-project/libretro-cap32", baseline: "g310cc579b79b", license: "COPYING", source: "source.tar.gz"},
  crocods: {repository: "https://github.com/retrom-project/libretro-crocods", baseline: "gbe00fb904da0", license: "LICENSE", source: "source.tar.gz"},
  same_cdi: {repository: "https://github.com/retrom-project/same_cdi", baseline: "gcfb05d803f54", license: "COPYING", source: "source.tar.gz"},
  vice_xpet: {repository: "https://github.com/retrom-project/vice-libretro", baseline: "g1b4309f4d56d", license: "COPYING", source: "vice_xpet-source.tar.gz", metadata: "vice_xpet-release.json"},
  vice_xplus4: {repository: "https://github.com/retrom-project/vice-libretro", baseline: "g1b4309f4d56d", license: "COPYING", source: "vice_xplus4-source.tar.gz", metadata: "vice_xplus4-release.json"},
  vice_xvic: {repository: "https://github.com/retrom-project/vice-libretro", baseline: "g1b4309f4d56d", license: "COPYING"},
  virtualjaguar: {repository: "https://github.com/retrom-project/virtualjaguar-libretro", baseline: "3.6.1", license: "LICENSE"},
  flycast: {repository: "https://github.com/retrom-project/flycast-wasm", baseline: "1.0", license: "LICENSE",
    adapterAbi: "emulatorjs-flycast-state-v1"},
};

export function forkReleaseFiles(catalog) {
  const forks = catalog.forks ?? [];
  if (!Array.isArray(forks) || new Set(forks.map((fork) => fork.runtimeCore)).size !== forks.length) {invalid();}
  return forks.flatMap((fork) => {
    const identity = identities[fork.runtimeCore];
    if (!identity || fork.repository !== identity.repository || !/^[0-9a-f]{40}$/u.test(fork.commit) ||
      fork.adapterAbi !== (identity.adapterAbi ?? "emulatorjs-state-v1") ||
      !new RegExp(`^retrom-core-${identity.baseline.replaceAll(".", "\\.")}-r[1-9][0-9]*(-rc\\.[1-9][0-9]*)?$`, "u")
        .test(fork.tag)) {invalid();}
    const release = identity.release ?? "4.2.3";
    const expected = [
      [`${fork.runtimeCore}-wasm.data`, `${release}/data/cores/${fork.runtimeCore}-wasm.data`],
      [identity.metadata ?? "rpg-runtime-release.json", forkMetadataPath(fork)],
      [identity.license, `${release}/licenses/forks/${fork.runtimeCore}/${identity.license}`],
      ...(identity.source ? [[identity.source, `${release}/licenses/forks/${fork.runtimeCore}/${identity.source}`]] : []),
      ...(fork.runtimeCore === "flycast" ? [["flycast.json", "4.2.3/data/cores/reports/flycast.json"]] : []),
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
  const records = fork.runtimeCore === "flycast" ? metadata.files : metadata.assets;
  if (metadata.repository !== fork.repository || metadata.commit !== fork.commit || metadata.tag !== fork.tag ||
    metadata.adapterAbi !== fork.adapterAbi || metadata.schemaVersion !== 1 || !Array.isArray(records)) {invalid();}
  const assets = fork.assets.filter((asset) => asset.filename !== (identities[fork.runtimeCore]?.metadata ?? "rpg-runtime-release.json"));
  if (records.length !== assets.length || new Set(records.map((entry) => entry.filename)).size !== records.length) {invalid();}
  for (const asset of assets) {
    const described = records.find((entry) => entry.filename === asset.filename);
    const digest = fork.runtimeCore === "flycast" ? described?.sha256 : described?.observedSha256;
    if (digest !== asset.sha256 || described.sizeBytes !== asset.sizeBytes) {invalid();}
  }
}

export function forkMetadataPath(fork) {
  const release = identities[fork.runtimeCore]?.release ?? "4.2.3";
  return `${release}/data/cores/reports/${fork.runtimeCore}${fork.runtimeCore === "flycast" ? "-release" : ""}.json`;
}

function invalid() {throw new Error("EMULATORJS_FORK_RELEASE_INVALID");}
