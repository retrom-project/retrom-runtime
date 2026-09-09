import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {expect, it} from 'vitest';
import {sha256} from '../scripts/provider-sources.mjs';
import {stageWebMSXRelease, validWebMSXRelease} from '../scripts/webmsx-release.mjs';

it('verifies pinned release provenance and every asset before writing any output', async () => {
  const sources = JSON.parse(await readFile('provider-sources.json', 'utf8'));
  const release = sources.upstreamReleases.find((entry: {id: string}) => entry.id === 'webmsx');
  const data = new Uint8Array([1, 2, 3]);
  release.assets = release.assets.map((asset: object) => ({...asset, sizeBytes: data.length, sha256: sha256(data)}));
  const metadata = {schemaVersion: 1, repository: release.repository, tag: release.tag,
    commit: release.commit, adapterAbi: release.adapterAbi, upstreamRepository: 'https://github.com/ppeccin/WebMSX',
    upstreamCommit: release.upstreamCommit, licenseStatus: 'UNRESOLVED', systemRomDistributionStatus: 'UNRESOLVED',
    sourceTreeSha256: 'b'.repeat(64),
    files: release.assets.map((asset: {filename: string; sizeBytes: number; sha256: string}) =>
      ({filename: asset.filename, sizeBytes: asset.sizeBytes, sha256: asset.sha256}))};
  const directory = await mkdtemp(join(tmpdir(), 'webmsx-release-'));
  const stage = pathToFileURL(directory + '/');
  try {
    expect(validWebMSXRelease(release)).toBe(true);
    expect(validWebMSXRelease({...release, tag: 'latest'})).toBe(false);
    expect(validWebMSXRelease({...release, upstreamCommit: 'a'.repeat(40)})).toBe(false);
    for (const invalid of [{...metadata, commit: 'a'.repeat(40)}, {...metadata, licenseStatus: 'MIT'},
      {...metadata, files: [...metadata.files, metadata.files[0]]}]) {
      await expect(stageWebMSXRelease(release, invalid, async () => data, stage))
        .rejects.toThrow('WEBMSX_RELEASE_METADATA_INVALID');
    }
    await expect(stageWebMSXRelease(release, metadata, async () => new Uint8Array([3, 2, 1]), stage))
      .rejects.toThrow('WEBMSX_RELEASE_ASSET_INVALID');
    await expect(readFile(join(directory, release.assets[0].output))).rejects.toMatchObject({code: 'ENOENT'});
    await stageWebMSXRelease(release, metadata, async () => data, stage);
    expect(await readFile(join(directory, release.assets[1].output))).toEqual(Buffer.from(data));
  } finally {await rm(directory, {recursive: true, force: true});}
});
