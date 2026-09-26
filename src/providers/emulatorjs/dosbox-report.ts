type ReportDownload = (path: string, type: string, ...args: unknown[]) => Promise<unknown>;
export type ReportInstance = {downloadFile?: ReportDownload};

const reportPath = /^cores\/reports\/dosbox_pure\.json\?v=\d+$/;

/** Pinned EmulatorJS 4.3 returns a cache item for text reports, even when the response is JSON. */
export function installDOSBoxReportCompatibility(instance: ReportInstance, coreSha256: string) {
  const original = instance.downloadFile;
  if (typeof original !== "function" || !/^[0-9a-f]{64}$/.test(coreSha256)) {throw invalid();}
  const compatible: ReportDownload = async (path, type, ...args) => {
    const result = await original.call(instance, path, type, ...args);
    if (type !== "Reports" || !reportPath.test(path) || result === -1) {return result;}
    return {...expectResult(result), data: decodeReport(result, coreSha256)};
  };
  instance.downloadFile = compatible;
  return () => {if (instance.downloadFile === compatible) {instance.downloadFile = original;}};
}

function expectResult(value: unknown): {data: unknown; headers?: unknown} {
  if (!value || typeof value !== "object" || !("data" in value)) {throw invalid();}
  return value;
}

function decodeReport(value: unknown, coreSha256: string) {
  const result = expectResult(value);
  const files = (result.data as {files?: unknown})?.files;
  const bytes = Array.isArray(files) && files.length === 1 ? files[0]?.bytes : null;
  if (!ArrayBuffer.isView(bytes) || !bytes.byteLength || bytes.byteLength > 64 * 1024) {throw invalid();}
  let metadata;
  try {metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));}
  catch {throw invalid();}
  const asset = metadata?.files?.find((file: {filename?: string}) => file.filename === "dosbox_pure-thread-wasm.data");
  if (metadata?.kind !== "RETROM_CORE_CANDIDATE_V1" || metadata.coreId !== "dosbox_pure" || metadata.dirty !== false ||
    asset?.sha256 !== coreSha256) {throw invalid();}
  return {...metadata, buildStart: coreSha256};
}

function invalid() {return new Error("PLAYER_DOS_REPORT_INVALID");}
