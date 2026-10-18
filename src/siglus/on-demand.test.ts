import {afterEach, expect, it, vi} from "vitest";
import {SiglusContent} from "./content.js";
import {siglusTarget} from "../providers/retrom-runtime/siglus-declaration.js";
import {abi} from "../content-io/identity.js";
import type {AdapterContentSession} from "../provider/content-inputs.js";

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

it("mounts a cold project index without downloading unused executables, music or movies", async () => {
  const rows = ["Scene.pck", "Gameexe.dat", "SiglusEngine.exe", "SiglusEngine.exe.bak", "BGM/unused.nwa", "MOV/ending.omv"]
    .map((path, index) => ({path, sizeBytes: index + 1, sha256: "a".repeat(64),
      url: `http://localhost/game/${path}`, mediaType: "application/octet-stream"}));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schemaVersion: 1, files: rows}))));
  let current = 0;
  const session: AdapterContentSession = {
    preloaded: false,
    inputPolicy: () => siglusTarget.contentIO.game as ReturnType<AdapterContentSession["inputPolicy"]>,
    open: vi.fn(async source => ({id: String(current++), sizeBytes: source.sizeBytes, abi,
      close: vi.fn(async () => {}), readInto: vi.fn(), tryReadInto: vi.fn(), stream: vi.fn()})),
    closeFile: vi.fn(async () => {}),
    materialize: vi.fn(async () => ({kind: "BLOB" as const, blob: new Blob(["unused"]), release: vi.fn(async () => {}),
      receipt: {objectKey: "a".repeat(64), storageGeneration: "g", sizeBytes: 6,
        localSha256: "a".repeat(64), assurance: "TRUSTED_IMMUTABLE_INDEX" as const, pinnedEtag: '"g"'}})),
  };
  const content = new SiglusContent({assetIndex: {}, contentSession: session});
  try {
    const files = await content.project("http://localhost/game/index.json", "b".repeat(64));
    expect(files.map(file => file.path)).toEqual(rows.map(file => file.path));
    expect(session.open).not.toHaveBeenCalled();
    expect(session.materialize).not.toHaveBeenCalled();
  } finally {await content.close();}
});
