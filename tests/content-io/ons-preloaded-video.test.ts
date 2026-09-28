import {afterEach, expect, it, vi} from "vitest";
import {createOnsProjectFileMap} from "../../src/ons/project-files.js";
import {contentSessionFixture} from "../content-session-fixture.js";

const receipt = {objectKey: "video", storageGeneration: "fixture", sizeBytes: 5,
  localSha256: "a".repeat(64), assurance: "TRUSTED_IMMUTABLE_INDEX" as const, pinnedEtag: '"fixture"'};

afterEach(() => {vi.unstubAllGlobals();});

it("preloaded ONS video uses a leased local Blob and releases it independently of its reader", async () => {
  const owner = contentSessionFixture(location.origin, undefined, "onscripter-yuri");
  Object.assign(owner.session, {preloaded: true});
  const release = vi.fn(async () => {}), create = vi.fn(() => "blob:local-video"), revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {static createObjectURL = create; static revokeObjectURL = revoke;});
  const materialize = vi.spyOn(owner.session, "materialize").mockResolvedValue({kind: "BLOB", blob: new Blob(["movie"]), receipt, release});
  const project = createOnsProjectFileMap([{path: "movie.mp4", sizeBytes: 5, url: "/movie"}], window, () => {},
    {contentSession: owner.session, projectDigest: "a".repeat(64)});
  try {
    const source = await project.videoSource!(project.fileMap["/game/movie.mp4"]);
    expect(source.url).toBe("blob:local-video");
    expect(materialize).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({kind: "BLOB"}), expect.any(AbortSignal));
    expect(owner.files.size).toBe(0);
    expect(release).not.toHaveBeenCalled();
    source.release();
    expect(revoke).toHaveBeenCalledWith(source.url);
    expect(release).toHaveBeenCalledOnce();
  } finally {await project.close(); await owner.close();}
});

it("closing ONS during video preparation releases a late Blob without publishing its URL", async () => {
  const owner = contentSessionFixture(location.origin, undefined, "onscripter-yuri");
  Object.assign(owner.session, {preloaded: true});
  const release = vi.fn(async () => {}), create = vi.fn();
  vi.stubGlobal("URL", class extends URL {static createObjectURL = create;});
  let resolve!: () => void;
  const barrier = new Promise<void>(done => {resolve = done;});
  const materialize = vi.spyOn(owner.session, "materialize").mockImplementation(async () => {
    await barrier; return {kind: "BLOB", blob: new Blob(["movie"]), receipt, release};
  });
  const project = createOnsProjectFileMap([{path: "movie.mp4", sizeBytes: 5, url: "/movie"}], window, () => {},
    {contentSession: owner.session, projectDigest: "a".repeat(64)});
  const pending = project.videoSource!(project.fileMap["/game/movie.mp4"]);
  const rejected = expect(pending).rejects.toThrow("ABORTED");
  await vi.waitFor(() => expect(materialize).toHaveBeenCalledOnce());
  const closing = project.close(); resolve(); await closing; await rejected;
  expect(create).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
  await owner.close();
});
