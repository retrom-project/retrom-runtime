// Candidate-only inputs. Formal builds reject these until the owned forks are released.
export const emulatorJsDevelopmentCoreSources = [
  {
    "id": "flycast",
    "repository": "https://github.com/retrom-project/flycast-wasm",
    "adapterAbi": "emulatorjs-flycast-state-v1",
    "files": [
      {
        "filename": "LICENSE",
        "sha256": "71433d9114710e9d2f65310c43561515c051fc13500de981fd1ebe7ce499ba92",
        "sizeBytes": 61843,
        "output": "4.2.3/licenses/forks/flycast/LICENSE"
      },
      {
        "filename": "flycast-rom-requirements.json",
        "sha256": "6cf37e6599d56cd555b61807216c1d1ffcd3b430a027940df71dfaa81be892a9",
        "sizeBytes": 258676,
        "output": "4.2.3/data/cores/flycast-rom-requirements.json"
      },
      {
        "filename": "flycast-wasm.data",
        "sha256": "4e2d15a35d7a28e094465ff69fe040ee428bac04f9dd955e329430ce7ebecc2f",
        "sizeBytes": 3546423,
        "output": "4.2.3/data/cores/flycast-wasm.data"
      },
      {
        "filename": "flycast.json",
        "sha256": "215107a9bf4af4fd96f89d864b0ad927edb6e878616d851417dcf50a56bde814",
        "sizeBytes": 92,
        "output": "4.2.3/data/cores/reports/flycast.json"
      }
    ]
  },
  {
    "id": "fbneo",
    "repository": "https://github.com/retrom-project/FBNeo",
    "adapterAbi": "emulatorjs-content-result-v1",
    "files": [
      {
        "filename": "LICENSE",
        "sha256": "85fef85fe2c4b8c14ef25ba7e2f251580dcfa01f8be09cd9781b378cf2cd5af7",
        "sizeBytes": 46417,
        "output": "4.2.3/licenses/forks/fbneo/LICENSE"
      },
      {
        "filename": "fbneo-arcade.dat",
        "sha256": "1864074639d42c2b6a7ad407e2df609c8824041408e42421eb7fa58fce5993e7",
        "sizeBytes": 11297869,
        "output": "4.2.3/data/cores/fbneo-arcade.dat"
      },
      {
        "filename": "fbneo-content-pair.json",
        "sha256": "61b649cb699e390306ff918b0d7c1e91590485aa38367fabe024c516dfd0b8af",
        "sizeBytes": 732,
        "output": "4.2.3/data/cores/fbneo-content-pair.json"
      },
      {
        "filename": "fbneo-wasm.data",
        "sha256": "4596557fc573bc7d311b249c6957768e03e5498bb83d08aaf7b41d407faf62ae",
        "sizeBytes": 8684348,
        "output": "4.2.3/data/cores/fbneo-wasm.data"
      },
      {
        "filename": "fbneo.json",
        "sha256": "5d3d8d417e49ef7a4268191800fccdf3efcebaff8121d358d5b9c713fff26170",
        "sizeBytes": 117,
        "output": "4.2.3/data/cores/reports/fbneo.json"
      }
    ]
  },
  {
    "id": "azahar",
    "repository": "https://github.com/retrom-project/azahar",
    "adapterAbi": "emulatorjs-content-result-v1",
    "files": [
      {
        "filename": "LICENSE",
        "sha256": "a9235748f6769959c0a32e77316870b4d296933a7e914d4957741d10095c8c9a",
        "sizeBytes": 514513,
        "output": "4.3.0-pre/licenses/forks/azahar/LICENSE"
      },
      {
        "filename": "azahar-thread-wasm.data",
        "sha256": "97db19118be320907b78227408fdeb339fc9fdf126ec14e9dcc0ac663a60b6a4",
        "sizeBytes": 4033927,
        "output": "4.3.0-pre/data/cores/azahar-thread-wasm.data"
      },
      {
        "filename": "azahar.json",
        "sha256": "f15c560df7dc5038d0e8026b45f6ab05e11bb8a5cacbb801059e81e4db586a97",
        "sizeBytes": 208,
        "output": "4.3.0-pre/data/cores/reports/azahar.json"
      }
    ]
  }
];
