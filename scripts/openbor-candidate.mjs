import {orderedCoreCandidate} from "./ordered-core-candidate.mjs";

export const {asCandidateSource: asOpenBORCandidateSource, validSource: validOpenBORSource,
  stageCandidate: stageOpenBORCandidate} = orderedCoreCandidate({
  id: "openbor", repository: "https://github.com/retrom-project/openbor", adapterAbi: "openbor-host-v1",
  filenames: ["LICENSE", "LICENSES.txt", "openbor.mjs", "openbor.wasm"],
  output: name => name.startsWith("LICENSE") ? `licenses/openbor/${name}` : `runtime/openbor/${name}`,
  maximum: name => name === "openbor.wasm" ? 67108864 : 4194304,
  errorCode: "OPENBOR_CANDIDATE_INVALID",
});
