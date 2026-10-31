import {cxFilterFS} from "../kirikiri/normalize.mjs";
import {hxv4} from "../kirikiri/hxv4-normalize.mjs";
import {electronAsar, nwEmbeddedZip} from "./web-containers.mjs";
import {molebox4} from "./molebox.mjs";
import {xmoeResourcePatch} from "./xmoe.mjs";

// Explicit, reviewed host-only registrations. No discovery, game-name dispatch or
// browser imports: adding a format requires only a plugin and this registration.
export const normalizers = Object.freeze([molebox4, xmoeResourcePatch, cxFilterFS, hxv4, electronAsar, nwEmbeddedZip]);
