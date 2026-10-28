import {orderedCoreCandidate} from "./ordered-core-candidate.mjs";

export const {asCandidateSource: asWebMSXCandidateSource, validSource: validWebMSXSource,
  stageCandidate: stageWebMSXCandidate} = orderedCoreCandidate({
  id: "webmsx", repository: "https://github.com/retrom-project/WebMSX", adapterAbi: "webmsx-host-v1",
  filenames: ["UPSTREAM-NOTICE.txt", "webmsx.js"],
  output: name => name === "UPSTREAM-NOTICE.txt" ? `licenses/webmsx/${name}` : `runtime/webmsx/${name}`,
  maximum: name => name === "webmsx.js" ? 8388608 : 65536,
  errorCode: "WEBMSX_CANDIDATE_INVALID",
});
