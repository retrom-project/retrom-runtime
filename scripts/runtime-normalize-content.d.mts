import type {RuntimeContentFile} from "../src/runtime/types.js";
export function normalizeContent(input: {platformId: string; files: RuntimeContentFile[]; locators?: Record<string, string>; outputRoot?: string}): Promise<{files: Array<RuntimeContentFile & {path?: string}>}>;
