import {readFile} from 'node:fs/promises';
import {expect, it} from 'vitest';
import {validateProviderSources} from '../scripts/provider-sources.mjs';
import {asWebMSXCandidateSource, validWebMSXSource, stageWebMSXCandidate} from '../scripts/webmsx-candidate.mjs';
import {assertScummvmCandidateMode} from '../scripts/scummvm-release.mjs';
it('pins published WebMSX bytes and keeps unpublished overrides restricted', async () => {
  const sources = JSON.parse(await readFile('provider-sources.json', 'utf8'));
  expect(() => validateProviderSources(sources)).not.toThrow();
  const release = sources.upstreamReleases.find((entry: {id: string}) => entry.id === 'webmsx');
  expect(release.tag).toBe('retrom-core-6.0.8-r1');
  expect(sources.developmentInputs?.some((source: {id: string}) => source.id === "webmsx") ?? false).toBe(false);
  const source = asWebMSXCandidateSource(release);
  expect(source).toMatchObject({repository: 'https://github.com/retrom-project/WebMSX',
    upstreamCommit: '4f4009e86d3e0bb9be7dcd7f0a582b0cd411d660', adapterAbi: 'webmsx-host-v1'});
  expect(source).not.toHaveProperty('tag');
  expect(validWebMSXSource(source)).toBe(true);
  expect(validWebMSXSource({...source, adapterAbi: 'unknown'})).toBe(false);
  expect(validWebMSXSource({...source, assets: [...source.assets, source.assets[0]]})).toBe(false);
  await expect(stageWebMSXCandidate(source, undefined, new URL('file:///tmp/'))).rejects.toThrow('UNPUBLISHED_CORE_INPUT');
  expect(() => assertScummvmCandidateMode([source], false, true)).toThrow();
  expect(() => assertScummvmCandidateMode([source], true, false)).not.toThrow();
});

it('stages only verified closed core assets and rejects tampering, extras and symlinks', async () => {
  const {mkdtemp, mkdir, writeFile, rm, symlink} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {pathToFileURL} = await import('node:url');
  const {createHash} = await import('node:crypto');
  const root = await mkdtemp(join(tmpdir(), 'retrom-webmsx-'));
  const input = join(root, 'input'); const output = join(root, 'stage');
  await mkdir(input); await mkdir(output);
  const source = asWebMSXCandidateSource(JSON.parse(await readFile('provider-sources.json', 'utf8'))
    .upstreamReleases.find((entry: {id: string}) => entry.id === 'webmsx'));
  const contents = [['UPSTREAM-NOTICE.txt', 'Unpublished input.'], ['webmsx.js', 'window.core = {};']];
  const descriptor = {schemaVersion: 1, kind: 'RETROM_CORE_CANDIDATE_V1', coreId: 'webmsx',
    repository: source.repository, branch: 'feat/webmsx', commit: source.upstreamCommit, dirty: true,
    sourceTreeSha256: 'a'.repeat(64), adapterAbi: source.adapterAbi,
    files: contents.map(([filename, bytes]) => ({filename, sizeBytes: Buffer.byteLength(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex')}))};
  const stage = pathToFileURL(output + '/');
  try {
    for (const [name, bytes] of contents) {await writeFile(join(input, name), bytes);}
    await writeFile(join(input, 'retrom-core-candidate.json'), JSON.stringify(descriptor));
    expect(await stageWebMSXCandidate(source, input, stage)).toEqual([
      'licenses/webmsx/UPSTREAM-NOTICE.txt', 'runtime/webmsx/webmsx.js']);
    expect(await readFile(join(output, 'runtime/webmsx/webmsx.js'), 'utf8')).toBe(contents[1][1]);
    await writeFile(join(input, 'webmsx.js'), 'window.evil = {};');
    await expect(stageWebMSXCandidate(source, input, stage)).rejects.toThrow('WEBMSX_CANDIDATE_INVALID');
    await writeFile(join(input, 'webmsx.js'), contents[1][1]);
    await writeFile(join(input, 'extra.js'), 'unexpected');
    await expect(stageWebMSXCandidate(source, input, stage)).rejects.toThrow('WEBMSX_CANDIDATE_INVALID');
    await rm(join(input, 'extra.js'));
    await rm(join(input, 'webmsx.js'));
    await symlink(join(output, 'runtime/webmsx/webmsx.js'), join(input, 'webmsx.js'));
    await expect(stageWebMSXCandidate(source, input, stage)).rejects.toThrow('WEBMSX_CANDIDATE_INVALID');
  } finally {await rm(root, {recursive: true, force: true});}
});
