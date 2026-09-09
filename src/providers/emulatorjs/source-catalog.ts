export const emulatorJsSourceCatalog = {
  schemaVersion: 1,
  developmentForks: [
  {
    "runtimeCore": "cap32",
    "repository": "https://github.com/retrom-project/libretro-cap32",
    "upstreamCommit": "310cc579b79b6051b378b192224b325a73437c9b",
    "commit": "d20dacb9ac3a44be8550189cffbd6f030057b972",
    "sourceTreeSha256": "a2d0e0ddf560889a57a0d78fa90b9a07a065dfb87c8c8f1cc7fb97792cf681aa",
    "adapterAbi": "emulatorjs-state-v1",
    "assets": [
      {
        "filename": "COPYING",
        "sha256": "328d7bdacd7f3aa9f03e9b78036b5a00db53907c8cb7a8676b4ba9016430f2be",
        "sizeBytes": 20252
      },
      {
        "filename": "cap32-wasm.data",
        "sha256": "c1548926863c4396620e8fc1c951e22c332b269a0614e8cc718f126ffe42493f",
        "sizeBytes": 1028234
      },
      {
        "filename": "retrom-core-candidate.json",
        "sizeBytes": 744,
        "sha256": "90ebf7361c8f4aaf7f80a263e943e3b25544666fce3129e58306a30e33a6f093"
      },
      {
        "filename": "source.tar.gz",
        "sha256": "90b93964822244c8c5c40d637f72735faac7ad5e1f0d90cfc318e58817ad5243",
        "sizeBytes": 1356576
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
