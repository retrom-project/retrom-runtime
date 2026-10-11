"""Search metadata shared by verified DAT fact generators."""


def labels(record):
    result = {field: ' '.join((record.findtext(field) or '').split())
              for field in ('description', 'year', 'manufacturer')}
    return {key: value for key, value in result.items() if value}
