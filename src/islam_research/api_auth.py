"""Verify signed IAP assertions using maintained ES256 verification.

Unsigned identity headers, browser-provided owner flags, and email text are not
authorization. Only the configured stable subject from a verified IAP token is.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Callable

import jwt

IAP_ISSUER = "https://cloud.google.com/iap"
IAP_KEYS = "https://www.gstatic.com/iap/verify/public_key"


class InvalidIdentity(Exception):
    """The request lacks a valid signed identity."""


class IdentityUnavailable(Exception):
    """Trusted signing keys could not be obtained within a bounded request."""


def fetch_iap_keys() -> dict[str, str]:
    """Fetch only Google's fixed public-key endpoint with bounded size/time."""
    with urllib.request.urlopen(IAP_KEYS, timeout=5) as response:
        body = response.read(262145)
    if len(body) > 262144:
        raise IdentityUnavailable("Signing key response too large")
    keys = json.loads(body)
    if not isinstance(keys, dict) or not keys or any(
        not isinstance(k, str) or not isinstance(v, str) for k, v in keys.items()
    ):
        raise IdentityUnavailable("Invalid signing key response")
    return keys


@dataclass
class IAPVerifier:
    """Cache trusted signing keys and reject invalid algorithm/claims/subject.

    A test may inject a key loader/clock, but production configuration has no
    alternate signing endpoint, unverified header mode, or authentication bypass.
    """
    audience: str
    owner_subject: str
    loader: Callable[[], dict[str, str]] = fetch_iap_keys
    clock: Callable[[], float] = time.monotonic
    _keys: dict = field(default_factory=dict, init=False, repr=False)
    _loaded: float = field(default=0, init=False, repr=False)
    _unavailable_until: float = field(default=0, init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    def verify(self, token: str) -> str:
        if not token or len(token) > 16384:
            raise InvalidIdentity("Missing or invalid identity")
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise InvalidIdentity("Invalid identity") from None
        kid = header.get("kid")
        if header.get("alg") != "ES256" or not isinstance(kid, str) or not 1 <= len(kid) <= 128:
            raise InvalidIdentity("Invalid identity")
        with self._lock:
            now = self.clock()
            # Unknown keys may refresh after 30s, not once per attacker-controlled kid.
            if not self._keys or now - self._loaded >= 300 or (kid not in self._keys and now - self._loaded >= 30):
                if now < self._unavailable_until:
                    raise IdentityUnavailable("Identity verification unavailable")
                try:
                    self._keys = self.loader()
                    self._loaded = now
                except Exception:
                    self._unavailable_until = now + 5
                    raise IdentityUnavailable("Identity verification unavailable") from None
            key = self._keys.get(kid)
        if not key:
            raise InvalidIdentity("Invalid identity")
        try:
            claims = jwt.decode(token, key, algorithms=["ES256"], audience=self.audience,
                                issuer=IAP_ISSUER, leeway=30,
                                options={"require": ["exp", "iat", "iss", "aud", "sub"]})
            if type(claims["exp"]) is not int or type(claims["iat"]) is not int:
                raise InvalidIdentity("Invalid identity")
            if claims["exp"] - claims["iat"] > 660 or claims["exp"] <= claims["iat"]:
                raise InvalidIdentity("Invalid identity lifetime")
            if claims["aud"] != self.audience or not isinstance(claims["sub"], str):
                raise InvalidIdentity("Invalid identity")
        except (jwt.PyJWTError, TypeError, ValueError):
            raise InvalidIdentity("Invalid identity") from None
        # A valid non-owner identity is different from a missing/forged token.
        if claims["sub"] != self.owner_subject:
            raise PermissionError("Owner access required")
        return claims["sub"]
