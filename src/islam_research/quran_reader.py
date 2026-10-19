"""Offline, pinned Qur’an representations. Domain references are edition independent.

No runtime fetching, provider credentials, scholarly promotion, or implicit repair.
"""
from functools import lru_cache
from hashlib import sha256
from importlib.resources import files
import re
import json

from .quran_citations import AYAH_COUNTS, PROFILE_ID, reference

RESOURCES = {
    'tanzil-uthmani': dict(filename='quran-uthmani-1.1.txt', sha256='bf4f57b968d03f4131c070b1e285da9be0e0a108a21c910e872801ca273312c8',
        label='Tanzil Uthmani · Version 1.1', language='ar', version='1.1',
        source_url='https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true',
        attribution='Tanzil Project', attribution_url='https://tanzil.net/', license_url='https://tanzil.net/docs/text_license',
        license='CC BY 3.0; verbatim text only', accessed_on='2026-10-18'),
    'itani-god': dict(filename='clearquran-god-2026-10-09.txt', sha256='a826ca75c8c0b8323c269a0061c2e5e365490e9479aebb15a242bf3ae30eb731',
        label='Talal Itani · ClearQuran · God edition', language='en', version='2026-10-09',
        source_url='https://d.clearquran.com/text/clearquran-god-edition.txt',
        attribution='Translation by Talal Itani, ClearQuran.com', attribution_url='https://clearquran.com/',
        license_url='https://blog.clearquran.com/download', license='CC BY-ND 4.0 with publisher’s formatting permissions; wording unchanged', accessed_on='2026-10-18'),
}
_NAMES_RAW=files('islam_research').joinpath('resources/quran-surah-names-v1.json').read_bytes()
if sha256(_NAMES_RAW).hexdigest()!='ddc72fb44895b544382127797145d1d4bf7da1ef1e815595f1f6d18a3e18215b':raise ValueError('Surah metadata changed; review its source before updating the pin')
NAMES_METADATA=json.loads(_NAMES_RAW)
NAMES={r['chapter']:r['label'] for r in NAMES_METADATA['chapters']}


def parse(raw, expected_digest):
    if sha256(raw).hexdigest() != expected_digest:
        raise ValueError('Qur’an source changed; inspect and version the new bytes before reading')
    verses, notice, current = {}, [], None
    for line in raw.decode('utf-8-sig').splitlines():
        if line.startswith('#'):
            notice.append(line)
        elif re.match(r'^\d+\|\d+\|', line):
            c, a, text = line.split('|', 2)
            current = (int(c), int(a))
            if current in verses: raise ValueError('Duplicate Qur’an reference')
            verses[current] = text
        elif line.strip():
            if current is None: raise ValueError('Unlocated Qur’an text')
            # The publisher uses real paragraph breaks inside some verses.
            verses[current] += '\n' + line
    expected = [(c,a) for c,n in enumerate(AYAH_COUNTS,1) for a in range(1,n+1)]
    if list(verses) != expected or any(not t.strip() or '\x00' in t for t in verses.values()):
        raise ValueError('Incomplete or mismatched Qur’an resource')
    return verses, '\n'.join(notice)


@lru_cache(maxsize=2)
def _load(key):
    if key not in RESOURCES: raise ValueError('Translation/resource is unavailable; no substitution was made')
    metadata=RESOURCES[key]
    verses,notice=parse(files('islam_research').joinpath('resources/'+metadata['filename']).read_bytes(),metadata['sha256'])
    return verses, {**metadata, 'key':key, 'resource_id':'urn:research:quran-resource:'+key+':'+metadata['sha256'],
        'profile_id':PROFILE_ID, 'source_notice':notice,
        'review_limit':'Identified provider text, not an independent scholarly review or commentary.', 'coverage':'114 surahs; 6236 numbered ayahs'}


def catalog():
    return dict(profile_id=PROFILE_ID,names_metadata=NAMES_METADATA, chapters=[dict(chapter=c,ayah_count=n,label=NAMES.get(c,f'Surah {c}')) for c,n in enumerate(AYAH_COUNTS,1)],
        resources=[dict(_load(k)[1]) for k in RESOURCES], unavailable=[
            dict(key='khattab',label='Mustafa Khattab · The Clear Quran',reason='Provider access and reuse authorization not configured.'),
            dict(key='saheeh',label='Saheeh International',reason='Provider access and reuse authorization not configured.')])


def chapter(chapter, translation='itani-god'):
    reference(chapter,1)
    if translation not in {'itani-god'}: raise ValueError('Named translation unavailable; no substitution was made')
    arabic,am=_load('tanzil-uthmani'); english,em=_load(translation)
    def text(value): return dict(text=value,text_sha256=sha256(value.encode()).hexdigest())
    return dict(chapter=chapter,profile_id=PROFILE_ID,label=NAMES.get(chapter,f'Surah {chapter}'),resources=[dict(am),dict(em)],
        verses=[dict(reference=reference(chapter,a),ayah=a,arabic=text(arabic[chapter,a]),translation=text(english[chapter,a])) for a in range(1,AYAH_COUNTS[chapter-1]+1)])


def representation(resource_key, chapter_number, start, end):
    target=reference(chapter_number,start,end)
    verses,resource=_load(resource_key)
    text='\n'.join(verses[chapter_number,a] for a in range(start,end+1))
    if len(text)>12000: raise ValueError('Choose a shorter range for an exact reading snapshot')
    return dict(resource=resource,reference=target,text=text,text_sha256=sha256(text.encode()).hexdigest())
