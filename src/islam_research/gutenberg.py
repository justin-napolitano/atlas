"""Bounded Gutenberg OPDS discovery and inert UTF-8 reading, never arbitrary URLs."""
from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timezone
import hashlib
import re
import threading
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
import xml.etree.ElementTree as ET

NS = {'a':'http://www.w3.org/2005/Atom', 'd':'http://purl.org/dc/terms/',
      'p':'http://www.gutenberg.org/2009/pgterms/', 'r':'http://www.w3.org/1999/02/22-rdf-syntax-ns#'}
BASE = 'https://www.gutenberg.org'
MIRROR = 'https://gutenberg.pglaf.org'
MAX_BYTES = 4_000_000
_lock = threading.Lock()
_cache = OrderedDict()
_last = 0.0
_backoff = 0.0


class Unavailable(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def identifier(value):
    if type(value) is not int or not 1 <= value <= 999999:
        raise ValueError('Choose a valid Gutenberg ebook number')
    return value


def _fetch(url, limit):
    global _last, _backoff
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc not in {'www.gutenberg.org','gutenberg.pglaf.org'}:
        raise ValueError('Unapproved catalog origin')
    if not (re.fullmatch(r'/ebooks/search\.opds/',parsed.path) or
            re.fullmatch(r'/cache/epub/[0-9]+/pg[0-9]+\.(rdf|txt)',parsed.path)):
        raise ValueError('Unapproved catalog route')
    now = time.monotonic()
    if now < _backoff:
        raise Unavailable('Catalog is resting after a provider error')
    time.sleep(max(0, 2 - (now - _last)))
    _last = time.monotonic()
    try:
        request = Request(url,headers={'User-Agent':'ResearchAtlas/0.1 (personal academic reader)',
                                     'Accept-Encoding':'identity'})
        with build_opener(NoRedirect).open(request,timeout=30) as response:
            if int(response.headers.get('Content-Length','0')) > limit:
                raise Unavailable('Representation is too large')
            data = response.read(limit+1)
            if len(data)>limit: raise Unavailable('Representation is too large')
            return data
    except Exception:
        _backoff = time.monotonic()+30
        raise Unavailable('Gutenberg is unavailable; try again shortly') from None


def _memo(key, loader, ttl=3600):
    # Serialize misses (including different searches) and pace all provider traffic.
    with _lock:
        old = _cache.get(key)
        if old and time.monotonic()-old[0]<ttl:
            _cache.move_to_end(key)
            return old[1]
        result = loader()
        _cache[key]=(time.monotonic(),result)
        _cache.move_to_end(key)
        while len(_cache)>12: _cache.popitem(last=False)
        return result


def _xml(raw):
    try: text=raw.decode('utf-8-sig')
    except UnicodeDecodeError: raise Unavailable('Only UTF-8 catalog XML is supported') from None
    if len(raw)>1_000_000 or '\x00' in text or '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise Unavailable('Unsupported catalog XML')
    try: return ET.fromstring(text)
    except ET.ParseError: raise Unavailable('Invalid catalog response') from None


def parse_search(raw, query, page):
    root=_xml(raw)
    if root.tag!='{'+NS['a']+'}feed': raise Unavailable('Invalid catalog feed')
    rows=[]
    for entry in root.findall('a:entry',NS):
        match=re.fullmatch(r'https://www\.gutenberg\.org/ebooks/([0-9]+)\.opds',entry.findtext('a:id','',NS))
        if not match: continue  # navigation, authors, subjects are not books
        book_id=identifier(int(match[1]))
        rows.append(dict(provider='gutenberg',book_id=book_id,title=entry.findtext('a:title','',NS)[:2000],
                         creators=entry.findtext('a:content','',NS)[:2000],
                         source_url=f'{BASE}/ebooks/{book_id}',availability='check_text'))
    more=any(link.get('rel')=='next' for link in root.findall('a:link',NS))
    return dict(items=rows[:25],next_page=page+1 if more and page<100 else None,query=query,
                provider='gutenberg',coverage='Project Gutenberg OPDS catalog; supported UTF-8 plain text only')


def search(query, page=1):
    if not isinstance(query,str) or not 1<=len(query.strip())<=200 or any(ord(c)<32 for c in query):
        raise ValueError('Search by title, author, subject or ebook number')
    if type(page) is not int or not 1<=page<=100: raise ValueError('Invalid catalog page')
    query=query.strip()
    params=urlencode(dict(query=query,start_index=(page-1)*25+1))
    return _memo(('search',query,page),lambda:parse_search(_fetch(BASE+'/ebooks/search.opds/?'+params,1_000_000),query,page))


def parse_metadata(raw, book_id):
    root=_xml(raw)
    ebook=root.find('p:ebook',NS)
    if ebook is None or ebook.get('{'+NS['r']+'}about')!=f'ebooks/{book_id}':
        raise Unavailable('Catalog identity did not match')
    def names(path): return [n.text[:500] for n in ebook.findall(path,NS) if n.text][:20]
    rights=ebook.findtext('d:rights','',NS)[:1000]
    utf8=False
    modified=''
    for file in ebook.findall('d:hasFormat/p:file',NS):
        url=file.get('{'+NS['r']+'}about','')
        kind=file.findtext('d:format/r:Description/r:value','',NS)
        if url==f'{BASE}/ebooks/{book_id}.txt.utf-8' and kind.lower()=='text/plain; charset=utf-8':
            utf8=True;modified=file.findtext('d:modified','',NS)[:100]
    return dict(provider='gutenberg',book_id=book_id,title=ebook.findtext('d:title','',NS)[:2000],
                creators=names('d:creator/p:agent/p:name'),
                translators=names('{http://id.loc.gov/vocabulary/relators/}trl/p:agent/p:name'),
                languages=names('d:language/r:Description/r:value'),rights=rights,
                release_date=ebook.findtext('d:issued','',NS)[:100],modified=modified,
                source_url=f'{BASE}/ebooks/{book_id}',
                availability='read' if utf8 and rights=='Public domain in the USA.' else 'provider_only',
                representation_url=f'{MIRROR}/cache/epub/{book_id}/pg{book_id}.txt',
                edition=f'Project Gutenberg digital ebook #{book_id}; original print edition unverified',
                attribution='Project Gutenberg · '+f'{BASE}/ebooks/{book_id}',
                rights_notice='Public domain in the USA according to the provider; other jurisdictions not assessed. Gutenberg license and source header remain available.',
                license_url=BASE+'/policy/license.html')


def sections(text):
    """Keep every Unicode code point; headings are navigation hints, not scholarly markup."""
    starts=[0]
    for match in re.finditer(r'(?m)^(?:CHAPTER|BOOK|PART|SECTION|LETTER)\s+[^\n]{1,100}$',text):
        if match.start()>starts[-1] and text[starts[-1]:match.start()].strip(): starts.append(match.start())
    starts.append(len(text))
    result=[]
    for a,b in zip(starts,starts[1:]):
        label=text[a:b].split('\n',1)[0].strip() if a else 'Opening'
        if not label: label='Reading'
        part=0
        while a<b:
            end=min(a+10000,b)
            if end<b:
                boundary=text.rfind('\n\n',a+5000,end)
                if boundary>a: end=boundary+2
                # Never split a combining sequence (notes use Unicode selectors).
                import unicodedata
                while end<b and unicodedata.category(text[end]) in {'Mn','Mc','Me'}: end-=1
            body=text[a:end]
            part+=1
            result.append(dict(index=len(result),label=label[:140]+(f' · part {part}' if part>1 else ''),
                               start=a,end=end,text=body,text_sha256=hashlib.sha256(body.encode()).hexdigest()))
            a=end
    return result


def parse_book(metadata, raw):
    if len(raw)>MAX_BYTES: raise Unavailable('Book exceeds this reader’s size limit')
    try: text=raw.decode('utf-8-sig').replace('\r\n','\n').replace('\r','\n')
    except UnicodeDecodeError: raise Unavailable('Only UTF-8 text is supported') from None
    if '\0' in text: raise Unavailable('Invalid plain text')
    start=re.search(r'(?im)^\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*[^\n]*(?:\n|$)',text)
    end=re.search(r'(?im)^\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*',text)
    if not start or not end or end.start()<=start.end():
        raise Unavailable('This book’s body boundaries are not supported yet')
    body=text[start.end():end.start()]
    if not body.strip(): raise Unavailable('Empty reading text')
    return dict(**metadata,version=hashlib.sha256(raw).hexdigest(),body_sha256=hashlib.sha256(body.encode()).hexdigest(),
                retrieved_at=datetime.now(timezone.utc).isoformat(),
                source_notice=text[:start.end()]+ '\n'+text[end.start():],
                sections=sections(body),normalization='gutenberg-body-lf-v1; no Unicode or interior whitespace folding')


def book(book_id):
    identifier(book_id)
    def load():
        meta=parse_metadata(_fetch(f'{BASE}/cache/epub/{book_id}/pg{book_id}.rdf',1_000_000),book_id)
        if meta['availability']!='read': return dict(**meta,sections=[])
        return parse_book(meta,_fetch(meta['representation_url'],MAX_BYTES))
    return _memo(('book',book_id),load,86400)
