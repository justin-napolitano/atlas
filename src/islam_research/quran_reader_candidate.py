"""Retired source-specific reader compatibility boundary."""
def _removed(*args, **kwargs):
    raise ValueError('This source-specific reader has been removed from Atlas')
chapter_resource = associate_verse = arabic_resource = translation_resource = _removed
