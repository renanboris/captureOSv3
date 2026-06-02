"""Smoke test for the production-hardening test scaffolding (Task 0).

Verifies the shared fixtures in ``tests/conftest.py`` are wired correctly.
This is scaffolding validation only -- it touches no product code and does not
implement any fix. The wave-2 tasks add the real exploration/preservation tests.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from pathlib import Path


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def test_simlink_module_factory_shape(simlink_module_factory):
    modulo = simlink_module_factory(total_passos=3)
    assert modulo["total_passos"] == 3
    assert len(modulo["hotspots"]) == 3
    # Keys must match contracts.simlink_models.SimlinkModulo so the API reads it.
    for key in ("modulo_id", "session_id", "titulo", "video_url", "xp_max", "criado_em"):
        assert key in modulo


def test_temp_simlink_dir_is_isolated_and_empty(temp_simlink_dir: Path):
    assert temp_simlink_dir.exists()
    assert temp_simlink_dir.name == "simlink"
    assert list(temp_simlink_dir.glob("*.json")) == []


def test_write_simlink_module_round_trips_and_cleans_up(write_simlink_module, simlink_dir: Path):
    path = write_simlink_module(titulo="Smoke Modulo", total_passos=2)
    assert path.exists()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["titulo"] == "Smoke Modulo"
    assert data["total_passos"] == 2
    # File lives in the real data/simlink dir the API reads from.
    assert path.parent == simlink_dir


def test_jwt_factory_valid_token_signature(jwt_factory, jwt_secret: str):
    token = jwt_factory["valid"](sub="user-123")
    header_b64, payload_b64, sig_b64 = token.split(".")
    payload = json.loads(_b64url_decode(payload_b64))
    assert payload["sub"] == "user-123"
    assert payload["exp"] > payload["iat"]

    expected_sig = hmac.new(
        jwt_secret.encode("utf-8"),
        f"{header_b64}.{payload_b64}".encode("ascii"),
        hashlib.sha256,
    ).digest()
    assert _b64url_decode(sig_b64) == expected_sig


def test_jwt_factory_invalid_token_has_bad_signature(jwt_factory, jwt_secret: str):
    token = jwt_factory["invalid"]()
    header_b64, payload_b64, sig_b64 = token.split(".")
    expected_sig = hmac.new(
        jwt_secret.encode("utf-8"),
        f"{header_b64}.{payload_b64}".encode("ascii"),
        hashlib.sha256,
    ).digest()
    # Signed with the wrong secret -> signature must NOT verify.
    assert _b64url_decode(sig_b64) != expected_sig


def test_jwt_factory_expired_token_is_in_the_past(jwt_factory):
    token = jwt_factory["expired"]()
    _, payload_b64, _ = token.split(".")
    payload = json.loads(_b64url_decode(payload_b64))
    assert payload["exp"] < payload["iat"]


def test_jwt_factory_auth_header_format(jwt_factory):
    token = jwt_factory["valid"]()
    header = jwt_factory["auth_header"](token)
    assert header["Authorization"] == f"Bearer {token}"
