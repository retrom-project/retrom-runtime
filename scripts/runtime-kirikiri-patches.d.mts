import type {ConfigureRequest} from "../src/runtime/configure.js";
import type {RuntimeContentFile} from "../src/runtime/types.js";
import type {HostContentLocator} from "./runtime-host-content.mjs";
type Input = {files: RuntimeContentFile[]; locators?: Record<string, HostContentLocator>; evidence?: ConfigureRequest["evidence"]};
export function withKirikiriPatchEvidence<T extends Input>(input: T, signal?: AbortSignal): Promise<T & {evidence: NonNullable<ConfigureRequest["evidence"]>}>;
export function hostLaunchOptions(input: Input & {platformId: string; config: unknown}, signal?: AbortSignal): Promise<ReturnType<typeof import("../src/runtime/kirikiri-patches.js").kirikiriPatchLaunches>>;
