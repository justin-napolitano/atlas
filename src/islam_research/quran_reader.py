"""Retired reader compatibility boundary. Atlas has no bundled scripture reader."""
from .quran_citations import reference
RESOURCES = {}
def _removed(*args, **kwargs):
    raise ValueError('This reader was removed from Atlas; add your own source instead')
_load = chapter = representation = _removed
def catalog():
    return {'resources': [], 'chapters': [], 'unavailable': []}
