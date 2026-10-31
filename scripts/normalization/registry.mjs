import {cxFilterFS} from "../kirikiri/normalize.mjs";
import {electronAsar, nwEmbeddedZip} from "./web-containers.mjs";
import {molebox4} from "./molebox.mjs";

// Explicit, reviewed host-only registrations. No discovery, game-name dispatch or
// browser imports: adding a format requires only a plugin and this registration.
export const normalizers = Object.freeze([molebox4, cxFilterFS, electronAsar, nwEmbeddedZip]);
