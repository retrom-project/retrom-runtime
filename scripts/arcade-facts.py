#!/usr/bin/env python3
"""Add searchable labels from each pinned, digest-verified DAT; never from a database."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from dat_labels import labels, rom_facts


def enrich(repository, inputs, refresh=False):
    sources = {item['coreId']: item for item in json.loads((repository / 'src/runtime/arcade-provenance.json').read_text())}
    path = repository / 'assets/facts/arcade-catalog.json.gz'
    catalogs = json.loads(gzip.decompress(path.read_bytes()))
    for core_id, filename in inputs:
        data = Path(filename).read_bytes()
        if hashlib.sha256(data).hexdigest() != sources[core_id]['sha256']:
            raise ValueError(f'DAT digest mismatch: {core_id}')
        root = ET.fromstring(data)
        records = root.findall('machine') or root.findall('game')
        indexed = {record.attrib['name']: record for record in records}
        if len(indexed) != len(records) or not refresh and set(indexed) != set(catalogs[core_id]):
            raise ValueError(f'DAT/facts entries differ: {core_id}')
        if refresh:
            catalogs[core_id] = {name: {'parent': record.get('romof') or record.get('cloneof'),
                                      'bios': record.get('isbios') == 'yes',
                                      'devices': sorted({r.attrib['name'] for r in record.findall('device_ref')}),
                                      'roms': rom_facts(record)} for name, record in indexed.items()}
        for name, facts in catalogs[core_id].items():
            record = indexed[name]
            facts.update(labels(record))
            facts['device'] = record.get('isdevice') == 'yes'
            facts['runnable'] = record.get('runnable') != 'no'
        print(json.dumps({'coreId': core_id, 'entries': len(indexed), 'sha256': sources[core_id]['sha256']}))
    path.write_bytes(gzip.compress(json.dumps(catalogs, separators=(',', ':'), ensure_ascii=False).encode(), mtime=0))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dat', action='append', required=True, metavar='CORE=PATH')
    parser.add_argument('--refresh', action='store_true', help='Regenerate ROM facts from the digest-verified paired DAT.')
    args = parser.parse_args()
    enrich(Path(__file__).resolve().parents[1], [value.split('=', 1) for value in args.dat], args.refresh)
