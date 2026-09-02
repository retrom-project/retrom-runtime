export const emulatorJsSourceCatalog = {
  schemaVersion: 1,
  overrides: [
    {
      destination: "4.2.3/data/cores/mame2003-wasm.data",
      runtimeCore: "mame2003",
      sha256: "1d8283ce042f71607b9b55656cd4068f703c52faa7a3d0940855c9dd21d542df",
      sizeBytes: 4993110,
      sourceRelease: "4.2.1",
      url: "https://cdn.emulatorjs.org/4.2.1/data/cores/mame2003-wasm.data",
    },
  ],
  releases: [
    {
      archive: {
        name: "4.2.3.7z",
        sha256: "07d451bc06fa3ad04ab30d9b94eb63ac34ad0babee52d60357b002bde8f3850b",
        sizeBytes: 303554683,
        url: "https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.2.3/4.2.3.7z",
      },
      commit: "e150dc0491ae747028919fb82d6598954976ede6",
      id: "4.2.3",
      licenseRoots: ["LICENSE", "THIRD_PARTY_NOTICES", "licenses"],
      repository: "https://github.com/EmulatorJS/EmulatorJS",
      tag: "v4.2.3",
    },
    {
      archive: {
        name: "4.3.0-pre.7z",
        sha256: "0949d75fa5cff05c47e0431443dad6b65e2ebc5f1517cbb09f3d671236d3effd",
        sizeBytes: 272494929,
        url: "https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.3.0-pre/4.3.0-pre.7z",
      },
      commit: "5628818822054610a2f06e61a6dc802fd1a3681f",
      id: "4.3.0-pre",
      licenseRoots: ["LICENSE", "THIRD_PARTY_NOTICES", "licenses"],
      repository: "https://github.com/EmulatorJS/EmulatorJS",
      tag: "v4.3.0-pre",
    },
  ],
} as const;
