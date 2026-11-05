"""Bounded, attributed verbatim pilot text; no network or edition inference."""
from __future__ import annotations

import hashlib
from importlib.resources import files
import json

from .quran_citations import reference

PILOT_SHA256 = "8d8880c3fb3a376e21fde80e56514058cae534ee3ca2b4124bdf792734838dc6"


def pilot_resource():
    """Return a fresh value, failing closed if the reviewed resource bytes change.

    This pin identifies an extraction, not scholarly verification of the text.
    License and full upstream notice travel with every response containing text.
    """
    raw = files("islam_research").joinpath("resources/quran-pilot-v1.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != PILOT_SHA256:
        raise ValueError("Pilot resource changed; review its provenance before updating the pin")
    value = json.loads(raw)
    value["artifact_sha256"] = PILOT_SHA256
    for verse in value["verses"]:
        verse["reference"] = reference(verse["chapter"], verse["ayah_start"], verse["ayah_end"])
    return value
