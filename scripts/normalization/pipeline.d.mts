import type {RuntimeContentFile} from "../../src/runtime/types.js";
import type {HostContentLocator} from "../runtime-host-content.mjs";
import type {NormalizationSummary} from "../runtime-normalize-content.mjs";
export interface NormalizationSources {files: RuntimeContentFile[]; locators?: Record<string, HostContentLocator>}
export interface NormalizationContext extends NormalizationSources {
  platformId: string; original: NormalizationSources;
  sourceContentHash: string; signal?: AbortSignal; cache: Map<string, unknown>;
}
export interface NormalizationPlan {format: string; claims: string[]; outputs: string[]; overrides?: string[]; launchDomain?: string}
export interface Normalizer {
  id: string; phase: "container" | "resource"; version: number; priority: number; platforms: string[]; formats: string[];
  probe(context: NormalizationContext): Promise<NormalizationPlan[]>;
  convert(context: NormalizationContext & {outputRoot: string; auditRoot: string}, plan: NormalizationPlan): Promise<{
    files: Array<RuntimeContentFile & {path: string}>; summary?: Partial<NormalizationSummary>;
  }>;
}
export function planNormalization(context: NormalizationContext, plugins: Normalizer[]): Promise<Array<{plugin: Normalizer; plan: NormalizationPlan}>>;
export function runNormalization(input: {platformId: string; files: RuntimeContentFile[]; locators?: Record<string, HostContentLocator>; outputRoot: string},
  plugins: Normalizer[], signal?: AbortSignal, workspaceRoot?: string): Promise<{files: Array<RuntimeContentFile & {path?: string}>; normalization?: NormalizationSummary}>;
