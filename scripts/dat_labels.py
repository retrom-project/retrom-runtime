"""Search metadata shared by verified DAT fact generators."""


def labels(record):
    result = {field: ' '.join((record.findtext(field) or '').split())
              for field in ('description', 'year', 'manufacturer')}
    return {key: value for key, value in result.items() if value}


def rom_facts(record):
    bios = record.findall('biosset')
    default = next((b.get('name') for b in bios if b.get('default') == 'yes'),
                   bios[0].get('name') if bios else None)
    roms = []
    for rom in record.findall('rom'):
        if not rom.get('crc') or rom.get('status') == 'nodump' or rom.get('bios') not in (None, default):
            continue
        entry = {key: rom.attrib[key] for key in ('name', 'size', 'crc')}
        for key in ('sha1', 'merge', 'bios'):
            if rom.get(key):
                entry[key] = rom.get(key)
        if rom.get('optional') == 'yes':
            entry['optional'] = True
        roms.append(entry)
    return roms


def disk_facts(record):
    """Keep disk requirements even when no dump is available; absence must not imply ROM-only."""
    return [{**{'name': disk.attrib['name'], 'sha1': disk.get('sha1'),
                'region': disk.get('region', ''), 'index': disk.get('index', '0'),
                'writable': disk.get('writable') == 'yes'},
             **{key: disk.attrib[key] for key in ('merge', 'status') if disk.get(key)},
             **({'optional': True} if disk.get('optional') == 'yes' else {})}
            for disk in record.findall('disk')]
