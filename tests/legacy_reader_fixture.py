"""Synthetic data for retained database compatibility, never a bundled reader.

Only the retired resource boundary is substituted. PostgreSQL storage, roles,
revision guards, backup and replay behavior remain the real implementations.
The historical resource key is a database compatibility identifier; no text or
metadata here represents the retired provider's content.
"""
from contextlib import ExitStack, contextmanager
from hashlib import sha256
from unittest.mock import patch


@contextmanager
def synthetic_legacy_reader():
    from islam_research import quran_reader, quran_resources, verse_store
    from islam_research.quran_citations import reference

    verses = [dict(chapter=4, ayah_start=ayah, text=f'SYNTHETIC LEGACY FIXTURE {ayah} — العربية 😀 é.')
              for ayah in (59, 83, 85)]
    digest = sha256('\n'.join(row['text'] for row in verses).encode()).hexdigest()
    resource = dict(
        key='itani-god', resource_id='synthetic:legacy-reader:fixture-v1',
        label='Synthetic legacy compatibility fixture', version='synthetic-v1',
        sha256=digest, source_sha256=digest, source_url='https://example.invalid/synthetic-legacy',
        license_url='https://example.invalid/synthetic-license', license_label='Synthetic authored fixture',
        attribution='Synthetic test author; no provider text',
        source_notice='SYNTHETIC TEST DATA ONLY; not a provider resource.',
        declared_version='synthetic-v1', text_type='synthetic', accessed_on='2000-01-01',
        review_limit='Synthetic compatibility test only; no interpretation or publication review.',
        reading_note='Synthetic authored text; no corpus was loaded.', verses=verses,
    )

    def representation(key, chapter, start, end):
        if key != resource['key'] or chapter != 4 or start != end:
            raise ValueError('Unavailable synthetic fixture selection')
        text = next(row['text'] for row in verses if row['ayah_start'] == start)
        return dict(resource=resource, reference=reference(chapter, start, end),
                    text=text, text_sha256=sha256(text.encode()).hexdigest())

    def load(key):
        if key != resource['key']:
            raise ValueError('Unavailable synthetic fixture resource')
        return None, resource

    with ExitStack() as stack:
        stack.enter_context(patch.object(quran_reader, 'RESOURCES', {resource['key']: resource}))
        stack.enter_context(patch.object(quran_reader, 'representation', side_effect=representation))
        stack.enter_context(patch.object(quran_reader, '_load', side_effect=load))
        stack.enter_context(patch.object(quran_resources, 'pilot_resource', return_value=resource))
        stack.enter_context(patch.object(verse_store, 'pilot_resource', return_value=resource))
        yield resource
