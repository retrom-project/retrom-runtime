import {orderedCoreCandidate} from "./ordered-core-candidate.mjs";

export const {asCandidateSource: asRuffleCandidateSource, validSource: validRuffleSource,
  stageCandidate: stageRuffleCandidate} = orderedCoreCandidate({
  id: "ruffle", repository: "https://github.com/retrom-project/ruffle", adapterAbi: "ruffle-host-v1",
  filenames: ["LICENSE.md", "LICENSE_APACHE", "LICENSE_MIT", "core.ruffle.js", "ruffle.js", "ruffle.wasm"],
  output: name => name.startsWith("LICENSE") ? `licenses/ruffle/${name}` : `runtime/ruffle/${name}`,
  maximum: name => name === "ruffle.wasm" ? 67108864 : 4194304,
  errorCode: "RUFFLE_CANDIDATE_INVALID",
});
