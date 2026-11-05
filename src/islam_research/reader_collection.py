"""Retired built-in collection compatibility boundary."""
def collection_resource():
    raise ValueError('Built-in reading collections have been removed; add your own sources')
