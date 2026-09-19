"""Read the selected Host's PFB/catalog APIs; never initialize or mutate a PFB."""
import json
import re
import sys
from pathlib import Path

retrom, runtime = (Path(value) for value in sys.argv[1:3])
name = sys.argv[3]
if not all(path.is_absolute() and path.resolve(strict=True) == path for path in (retrom, runtime)):
    raise ValueError('CONTENT_IO_PFB_PATH_INVALID')
sys.path[:0] = [str(retrom / 'scripts'), str(retrom)]
from pfb.spec import load_spec
from pfb.state import load_state
from pfb.identity import app_origin
from pfb.source_tree import worktree_identity
from workspace.catalog import parse_manifest

spec = load_spec(retrom)
if spec['name'] != name or Path(spec['runtime']['root']) != runtime:
    raise ValueError('CONTENT_IO_PFB_MISMATCH')
project = retrom.parent
if project.name != 'project' or project.parent.name != name or runtime.parent != project:
    raise ValueError('CONTENT_IO_PFB_LAYOUT_INVALID')
catalog = parse_manifest((retrom / 'workspace/manifest.yaml').read_text())
sources = json.loads((runtime / 'provider-sources.json').read_text())
required = {'ppsspp', 'play', 'mkxp', 'kirikiri2'}
cores = {}
for source in sources['upstreamReleases'] + sources.get('developmentInputs', []):
    if source['id'] not in required:
        continue
    matches = [repo for repo in catalog if repo['gitlink'].removesuffix('.git').replace('git@github.com:', 'https://github.com/') == source['repository']]
    if len(matches) != 1:
        raise ValueError('CONTENT_IO_CORE_CATALOG_MISMATCH:' + source['id'])
    repo = matches[0]
    path = project.parent / repo['path']
    registered = [entry for entry in spec['cores'] if Path(entry['root']) == path]
    detail = {'workspaceId': repo['id'], 'repository': source['repository'], 'buildId': source['id']}
    if not path.exists():
        detail.update(dict.fromkeys(('root', 'branch', 'commit', 'sourceTreeSha256', 'dirty')))
        detail.update(availability='SOURCE_UNAVAILABLE', reason='PFB core worktree is absent')
    else:
        if path.resolve(strict=True) != path or not path.is_relative_to(project):
            raise ValueError('CONTENT_IO_CORE_PATH_INVALID')
        if len(registered) != 1 or registered[0]['id'] != source['id']:
            raise ValueError('CONTENT_IO_CORE_ID_MISMATCH:' + source['id'])
        wrapper = path / '.github/rpg-runtime/build-candidate.sh'
        if not re.search(r'--core-id\s+' + re.escape(source['id']) + r'(?:\s|$)', wrapper.read_text()):
            raise ValueError('CONTENT_IO_CORE_BUILD_ID_MISMATCH')
        detail.update(worktree_identity(path), availability='AVAILABLE')
    cores[source['id']] = detail
if cores.keys() != required:
    raise ValueError('CONTENT_IO_CORE_SOURCE_MISSING')
print(json.dumps({
    'pfb': {'name': name, 'id': spec['id'], 'projectRoot': str(project),
            'specPath': str(retrom / '.pfb/spec.json'), 'hostOrigin': app_origin(spec['id'])},
    'state': load_state(retrom, spec['id']),
    'repositories': {'retrom': worktree_identity(retrom), 'runtime': worktree_identity(runtime), 'cores': cores},
}, sort_keys=True))
