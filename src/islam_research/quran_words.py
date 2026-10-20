"""On-demand Quran.com English word glosses, aligned to our unchanged Arabic.

No corpus download or persistent content cache. Only numeric verse references
leave the server; owner writing is never sent upstream.
"""
from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
import re
from threading import Lock
from time import monotonic
import unicodedata
from urllib.request import Request, build_opener, HTTPRedirectHandler

from .quran_reader import representation

SOURCE = 'https://api.quran.com/api/v4/verses/by_key/'
TERMS = 'https://api-docs.quran.foundation/legal/developer-terms/'
_cache, _lock = OrderedDict(), Lock()
_ttl, _limit = 86400, 128


def letters(value):
    # Alignment comparison only. Never return this as a replacement source text.
    return ''.join(c for c in unicodedata.normalize('NFD', value)
                   if unicodedata.category(c).startswith('L') and c != 'ـ').replace('ٱ', 'ا')


def align(payload, chapter, ayah):
    source = representation('tanzil-uthmani', chapter, ayah, ayah)
    verse = payload.get('verse', {})
    if verse.get('verse_key') != f'{chapter}:{ayah}':
        raise ValueError('The word translation belongs to another verse.')
    words = verse.get('words')
    if not isinstance(words, list) or not 1 <= len(words) <= 1000:
        raise ValueError('Word translation is unavailable for this verse.')
    tokens = [match for match in re.finditer(r'\S+', source['text']) if letters(match[0])]
    parts = [word for word in words if isinstance(word, dict) and word.get('char_type_name') == 'word']
    if len(tokens) != len(parts):
        raise ValueError('Word boundaries do not match this Arabic edition.')
    aligned = []
    for position, (token, word) in enumerate(zip(tokens, parts), 1):
        arabic, translation = word.get('text_uthmani'), word.get('translation', {})
        gloss = translation.get('text') if isinstance(translation, dict) else None
        if (word.get('position') != position or not isinstance(arabic, str)
                or letters(arabic) != letters(token[0]) or not isinstance(gloss, str)
                or not gloss.strip() or len(gloss) > 1000
                or translation.get('language_name') != 'english'):
            raise ValueError('The word translation could not be aligned to this edition.')
        aligned.append(dict(position=position, start=token.start(), end=token.end(),
                            arabic=token[0], translation=gloss))
    return dict(chapter=chapter, ayah=ayah, resource_key='tanzil-uthmani',
                text_sha256=source['text_sha256'], words=aligned,
                attribution='Quran.com / Quran Foundation · English word-by-word glosses',
                source_url=f'https://quran.com/{chapter}/{ayah}', terms_url=TERMS,
                accessed_at=datetime.now(timezone.utc).isoformat(),
                response_sha256=sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
                review_limit='Provider word glosses, not the Talal Itani verse translation or an independent lexical review.')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Word translation provider redirected unexpectedly.')


def lookup(chapter, ayah):
    # Validate before forming a URL, including ayah counts, not merely 1..286.
    representation('tanzil-uthmani', chapter, ayah, ayah)
    key = (chapter, ayah)
    with _lock:
        now = monotonic()
        for stale in [k for k, (expiry, _) in _cache.items() if expiry <= now]:
            del _cache[stale]
        if key in _cache:
            _cache.move_to_end(key)
            return deepcopy(_cache[key][1])
        # Serialize misses as well: concurrent selections never burst upstream.
        request = Request(f'{SOURCE}{chapter}:{ayah}?words=true&word_fields=text_uthmani&language=en',
                          headers={'Accept': 'application/json', 'User-Agent': 'ResearchAtlas/0.1 (word gloss reader)'})
        with build_opener(NoRedirect).open(request, timeout=8) as response:
            if response.headers.get_content_type() != 'application/json':
                raise ValueError('Word translation provider returned an unexpected format.')
            raw = response.read(512_001)
        if len(raw) > 512_000:
            raise ValueError('Word translation response exceeded its size limit.')
        value = align(json.loads(raw), chapter, ayah)
        _cache[key] = (monotonic() + _ttl, value)
        while len(_cache) > _limit:
            _cache.popitem(last=False)
        return deepcopy(value)
