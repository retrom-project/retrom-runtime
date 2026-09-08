export const emulatorJsSourceCatalog = {
  schemaVersion: 1,
  forks: [
    {
      "repository": "https://github.com/retrom-project/vice-libretro",
      "tag": "retrom-core-g1b4309f4d56d-r1-rc.2",
      "commit": "9bb2d8a9aab99b80b66a666bc24b0880170c4bc5",
      "adapterAbi": "emulatorjs-state-v1",
      "runtimeCore": "vice_xvic",
      "assets": [
        {
          "filename": "vice_xvic-wasm.data",
          "sha256": "beca7386b99240e7f74a16e5cba9f4578eefc58ac560a5c7dd5b0b9b145e1d7b",
          "sizeBytes": 1400115,
          "url": "https://github.com/retrom-project/vice-libretro/releases/download/retrom-core-g1b4309f4d56d-r1-rc.2/vice_xvic-wasm.data"
        },
        {
          "filename": "rpg-runtime-release.json",
          "sha256": "545b58275f9b26c0000521d3e835da0f0d83811db1207bb518b24d97b8a22f0d",
          "sizeBytes": 634,
          "url": "https://github.com/retrom-project/vice-libretro/releases/download/retrom-core-g1b4309f4d56d-r1-rc.2/rpg-runtime-release.json"
        },
        {
          "filename": "COPYING",
          "sha256": "b8a2f73f743dc1a51aff23f1aacbca4b868564db52496fa3c0caba755bfd1eaf",
          "sizeBytes": 17989,
          "url": "https://github.com/retrom-project/vice-libretro/releases/download/retrom-core-g1b4309f4d56d-r1-rc.2/COPYING"
        }
      ]
    },
    {
      "repository": "https://github.com/retrom-project/virtualjaguar-libretro",
      "tag": "retrom-core-3.6.1-r1-rc.2",
      "commit": "b86e2f0887968298695e3ad30cc1b9e83f108d00",
      "adapterAbi": "emulatorjs-state-v1",
      "runtimeCore": "virtualjaguar",
      "assets": [
        {
          "filename": "virtualjaguar-wasm.data",
          "sha256": "16b62c38e6921fb5b410ab507ba6bc77edcaccbba532ae4711b9521a4256ba6d",
          "sizeBytes": 1199923,
          "url": "https://github.com/retrom-project/virtualjaguar-libretro/releases/download/retrom-core-3.6.1-r1-rc.2/virtualjaguar-wasm.data"
        },
        {
          "filename": "rpg-runtime-release.json",
          "sha256": "09a2458299da4dc538c0aed65d5f55ec182e9c2fc7f970822a328c45cae7d694",
          "sizeBytes": 639,
          "url": "https://github.com/retrom-project/virtualjaguar-libretro/releases/download/retrom-core-3.6.1-r1-rc.2/rpg-runtime-release.json"
        },
        {
          "filename": "LICENSE",
          "sha256": "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
          "sizeBytes": 35147,
          "url": "https://github.com/retrom-project/virtualjaguar-libretro/releases/download/retrom-core-3.6.1-r1-rc.2/LICENSE"
        }
      ]
    }
  ],
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
      licenseRoots: ["LICENSE"],
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
      licenseRoots: ["LICENSE"],
      repository: "https://github.com/EmulatorJS/EmulatorJS",
      tag: "v4.3.0-pre",
    },
  ],
} as const;
