import type {PrepareRuntimeRequest, ContentBIOSRequest, RuntimeContentFile, BIOSRequirement} from "../src/runtime/index.js";
export type HostFiles = {files: RuntimeContentFile[]; locators: Record<string, string>; paths?: Record<string, string>; outputPath: string};
export function discoverContentDependencies(input: Pick<HostFiles, "files" | "locators"> & {
  directory?: import("../src/runtime/types.js").RuntimeDirectory; providerRoots?: Record<string,string>;
  sourceCandidates?: {sourcePath: string; sizeBytes: number; headerBase64: string}[];
}): Promise<{files: Array<{logicalKey: string; relativeTo?: string; relativePath?: string; sourcePath?: string; optional?: boolean}>;
  sourceSearch?: {extensions: string[]; headerBytes: number}}>;
export function configureHostInput(input: import("../src/runtime/configure.js").ConfigureRequest & {locators: Record<string, string>; providerRoots?: Record<string, string>}): Promise<import("../src/runtime/configure.js").ConfigureRequest>;
export function assembleResource(input: HostFiles): Promise<{path: string; sizeBytes: number; sha256: string}>;
export function parentArchive(input: HostFiles): Promise<{path: string; sizeBytes: number; sha256: string}>;
export function prepareHostInput(input: PrepareRuntimeRequest & {locators: Record<string, string>}): Promise<PrepareRuntimeRequest>;
export function contentHostBIOSRequirements(input: ContentBIOSRequest & {locators: Record<string, string>; providerRoots?: Record<string, string>; biosFiles?: Array<{requirementKey: string; filename: string; path: string}>}): Promise<ReturnType<typeof import("../src/runtime/prepare.js").contentBIOSRequirements>>;
export function hostDOSEntryCandidates(input: {config: unknown; files: RuntimeContentFile[]; locators: Record<string, string>}): Promise<{entries: string[]}>;
export function hostArcadeParentOptions(input: import("../src/runtime/arcade-parent.js").ArcadeParentRequest & {locators: Record<string, string>}): Promise<ReturnType<typeof import("../src/runtime/arcade-parent.js").arcadeParentOptions>>;
export function arcadeTables(): Promise<Record<string, import("../src/runtime/arcade.js").ArcadeCatalog>>;
export type BIOSCandidate = BIOSRequirement & {candidate?: {memberIdentity: string; matchedMembers: number; totalMembers: number}};
export function verifyHostBIOS(input: {requirement: BIOSRequirement; path: string}): Promise<null | {
  status: "valid" | "incomplete" | "invalid"; matchedMembers: number; expectedMembers: number; missingMembers: string[]}>;
export function identifyHostBIOS(input: {file: {name: string; sizeBytes: number; sha256: string; md5: string}; path?: string; requirements: BIOSRequirement[]}): Promise<BIOSCandidate[]>;
export function detectScummvm(input: {providerRoot: string; treeRoot: string}): Promise<unknown>;

export function flycastTable(root: string, requirement: {core: {path: string; sha256: string}; catalog: {path: string; sha256: string}}): Promise<import("../src/runtime/flycast-arcade.js").FlycastMachine[]>;

export function flycastConfigureEvidence(input: {platformId: string; coreIds: string[]; providerRoots?: Record<string,string>}): Promise<{flycastCatalogs?: Readonly<Record<string, readonly import("../src/runtime/flycast-arcade.js").FlycastMachine[]>>}>;
