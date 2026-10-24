import {cxFilterFS} from "../kirikiri/normalize.mjs";
import {electronAsar, nwEmbeddedZip} from "./web-containers.mjs";

// Explicit, reviewed host-only registrations. No discovery, game-name dispatch or
// browser imports: adding a format requires only a plugin and this registration.
export const normalizers = Object.freeze([cxFilterFS, electronAsar, nwEmbeddedZip]);
