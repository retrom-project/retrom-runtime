export const emulatorJsSourceCatalog = {
  schemaVersion: 1,
  developmentCores: [
  {
    "repository": "https://github.com/retrom-project/flycast-wasm",
    "adapterAbi": "emulatorjs-flycast-state-v1",
    "id": "flycast",
    "files": [
      {
        "filename": "LICENSE",
        "sha256": "71433d9114710e9d2f65310c43561515c051fc13500de981fd1ebe7ce499ba92",
        "sizeBytes": 61843,
        "output": "4.2.3/licenses/forks/flycast/LICENSE"
      },
      {
        "filename": "flycast-wasm.data",
        "sha256": "fab41d57ae056e318c893e1421495ba984088630e3d59b5494796412d34850b2",
        "sizeBytes": 3530830,
        "output": "4.2.3/data/cores/flycast-wasm.data"
      },
      {
        "filename": "flycast.json",
        "sha256": "215107a9bf4af4fd96f89d864b0ad927edb6e878616d851417dcf50a56bde814",
        "sizeBytes": 92,
        "output": "4.2.3/data/cores/reports/flycast.json"
      }
    ]
  }
],
  forks: [
    {
      "repository": "https://github.com/retrom-project/vice-libretro",
      "tag": "retrom-core-g1b4309f4d56d-r1",
      "commit": "515d625643e4b0fbc30f3ab185daab0e43331dd9",
      "adapterAbi": "emulatorjs-state-v1",
      "runtimeCore": "vice_xvic",
      "assets": [
        {
          "filename": "vice_xvic-wasm.data",
          "sha256": "8d77779568ff9ac2fe46f11ad6f37e39cc6be44dae337e0fb8cda4f29f283a49",
          "sizeBytes": 1400563,
          "url": "https://github.com/retrom-project/vice-libretro/releases/download/retrom-core-g1b4309f4d56d-r1/vice_xvic-wasm.data"
        },
        {
          "filename": "rpg-runtime-release.json",
          "sha256": "dc63426f1804edb9ca95a8417c68ec792c0ef52ec860ff1c0e99717415aeb8d9",
          "sizeBytes": 629,
          "url": "https://github.com/retrom-project/vice-libretro/releases/download/retrom-core-g1b4309f4d56d-r1/rpg-runtime-release.json"
        },
        {
          "filename": "COPYING",
          "sha256": "b8a2f73f743dc1a51aff23f1aacbca4b868564db52496fa3c0caba755bfd1eaf",
          "sizeBytes": 17989,
          "url": "https://github.com/retrom-project/vice-libretro/releases/download/retrom-core-g1b4309f4d56d-r1/COPYING"
        }
      ]
    },
    {
      "repository": "https://github.com/retrom-project/virtualjaguar-libretro",
      "tag": "retrom-core-3.6.1-r1",
      "commit": "b86e2f0887968298695e3ad30cc1b9e83f108d00",
      "adapterAbi": "emulatorjs-state-v1",
      "runtimeCore": "virtualjaguar",
      "assets": [
        {
          "filename": "virtualjaguar-wasm.data",
          "sha256": "16b62c38e6921fb5b410ab507ba6bc77edcaccbba532ae4711b9521a4256ba6d",
          "sizeBytes": 1199923,
          "url": "https://github.com/retrom-project/virtualjaguar-libretro/releases/download/retrom-core-3.6.1-r1/virtualjaguar-wasm.data"
        },
        {
          "filename": "rpg-runtime-release.json",
          "sha256": "b9443f7fc635a091b9460773bb0261bd5c4a9b5cb5ed3162286553e173e6c742",
          "sizeBytes": 634,
          "url": "https://github.com/retrom-project/virtualjaguar-libretro/releases/download/retrom-core-3.6.1-r1/rpg-runtime-release.json"
        },
        {
          "filename": "LICENSE",
          "sha256": "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
          "sizeBytes": 35147,
          "url": "https://github.com/retrom-project/virtualjaguar-libretro/releases/download/retrom-core-3.6.1-r1/LICENSE"
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
      licenseRoots: ["LICENSE", "licenses/forks/flycast"],
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
