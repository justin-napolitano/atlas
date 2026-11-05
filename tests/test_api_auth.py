import time
import unittest

try:
    import jwt
    from cryptography.hazmat.primitives.asymmetric import ec
    from islam_research.api_auth import IAPVerifier, InvalidIdentity, IdentityUnavailable, IAP_ISSUER
except ModuleNotFoundError:
    jwt = None

AUDIENCE = "/projects/123456789012/locations/us-central1/services/synthetic-owner"
OWNER = "synthetic-owner-subject"


@unittest.skipUnless(jwt, "Install the api extra for signed-identity tests")
class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.loads = 0
        def keys():
            self.loads += 1
            return {"test-key": self.key.public_key()}
        self.verifier = IAPVerifier(AUDIENCE, OWNER, loader=keys, clock=lambda: 100)

    def token(self, **changes):
        now = int(time.time())
        claims = dict(iss=IAP_ISSUER, aud=AUDIENCE, sub=OWNER, iat=now, exp=now + 600)
        claims.update(changes)
        return jwt.encode(claims, self.key, algorithm="ES256", headers={"kid": "test-key"})

    def test_valid_signature_and_stable_subject(self):
        self.assertEqual(self.verifier.verify(self.token()), OWNER)
        self.assertEqual(self.verifier.verify(self.token()), OWNER)
        self.assertEqual(self.loads, 1)

    def test_non_owner_is_forbidden_even_with_a_valid_signature(self):
        with self.assertRaises(PermissionError):
            self.verifier.verify(self.token(sub="synthetic-other-subject"))

    def test_wrong_audience_issuer_lifetime_and_missing_claim(self):
        now = int(time.time())
        for change in [dict(aud="wrong-resource"), dict(iss="https://example.invalid"),
                       dict(exp=now-60, iat=now-600), dict(iat=now+120),
                       dict(exp=now+2000), dict(exp="not-a-time"), dict(sub=None)]:
            with self.subTest(change=change), self.assertRaises(InvalidIdentity):
                self.verifier.verify(self.token(**change))

    def test_forged_signature_algorithm_and_malformed_token(self):
        other = ec.generate_private_key(ec.SECP256R1())
        forged = jwt.encode(jwt.decode(self.token(), options={"verify_signature": False}), other,
                            algorithm="ES256", headers={"kid": "test-key"})
        for token in ["", "not-a-jwt", forged,
                      jwt.encode({"sub": OWNER}, key="", algorithm="none", headers={"kid": "test-key"})]:
            with self.subTest(), self.assertRaises(InvalidIdentity):
                self.verifier.verify(token)

    def test_unknown_keys_do_not_refetch_for_every_attacker_request(self):
        self.verifier.verify(self.token())
        claims = jwt.decode(self.token(), options={"verify_signature": False})
        for number in range(5):
            token = jwt.encode(claims, self.key, algorithm="ES256", headers={"kid": f"unknown-{number}"})
            with self.assertRaises(InvalidIdentity):
                self.verifier.verify(token)
        self.assertEqual(self.loads, 1)

    def test_key_outage_does_not_fall_back_to_unsigned_headers(self):
        def failed():
            raise OSError("Synthetic key service outage")
        self.verifier.loader = failed
        with self.assertRaises(IdentityUnavailable):
            self.verifier.verify(self.token())
