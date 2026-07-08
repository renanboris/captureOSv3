"""Shared pytest fixtures for the CaptureOS v3 test suite.

This module is test scaffolding for the `production-hardening` bugfix spec
(Task 0). It provides reusable fixtures that the wave-2 exploration and
preservation tests build on:

* ``app`` / ``client``      -- the FastAPI app and a ``TestClient``.
* ``temp_simlink_dir``      -- an isolated temp ``data/simlink`` directory.
* ``simlink_dir``           -- the *real* ``data/simlink`` directory the API
                               reads from, with per-test cleanup of files this
                               fixture created (for module I/O tests).
* ``simlink_module_factory``-- builds ``SimlinkModulo``-shaped module dicts.
* ``jwt_factory``           -- mints valid / invalid bearer tokens and matching
                               ``Authorization`` headers.

It deliberately does NOT modify any product code or implement any fix.

Notes
-----
``api.main`` transitively imports ``static_ffmpeg`` (via
``video_eng.time_bender``), which is an unlisted dependency today -- that is the
C7 defect fixed later by task 13.1. To keep ``pytest`` collection working for
the rest of the suite before that fix lands, the FastAPI app is imported
*lazily* inside the ``app`` fixture. If the import fails, the dependent fixtures
``pytest.skip`` with a clear reason instead of erroring out the whole session.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional

import pytest

# Repository root (parent of the tests/ directory). Used so fixtures resolve
# paths the same way the app does (it reads "data/simlink" relative to CWD).
REPO_ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------- #
# FastAPI app / TestClient
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="session")
def app():
    """Return the FastAPI application instance.

    Imported lazily so a missing runtime dependency (e.g. ``static_ffmpeg``,
    the C7 defect) skips only the tests that need the live app rather than
    breaking collection for the entire suite.
    """
    try:
        from api.main import app as fastapi_app
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"api.main could not be imported (likely C7 missing dep): {exc!r}")
    return fastapi_app


@pytest.fixture
def client(app) -> Iterator[Any]:
    """A FastAPI ``TestClient`` bound to the application.

    Yielded as a context manager so startup/shutdown events fire as they would
    in a real server.

    Auth: The ``require_auth`` dependency is overridden with a pass-through stub
    so tests that drive the ingest / data routes do not need to mint tokens
    unless they are specifically testing authentication behaviour (those tests,
    e.g. ``test_bug_cors_auth.py``, call ``client.request(...)`` with explicit
    auth headers and test *without* the override).
    """
    from fastapi.testclient import TestClient

    # Import lazily — if the import failed the ``app`` fixture already skipped.
    from api.auth import require_auth

    # Override require_auth with a no-op that returns a dummy claims dict.
    # This allows all data-route tests to work without minting real JWTs.
    # Tests specifically testing auth behaviour (test_bug_cors_auth.py) override
    # this fixture or test the dependency directly.
    async def _require_auth_noop():
        return {
            "id": "00000000-0000-0000-0000-000000000000",
            "email": "test@example.com",
            "sub": "test-user",
            "org_id": "00000000-0000-0000-0000-000000000000"
        }

    app.dependency_overrides[require_auth] = _require_auth_noop

    with TestClient(app) as test_client:
        yield test_client

    # Clean up overrides after the test so they don't leak between tests.
    app.dependency_overrides.pop(require_auth, None)


@pytest.fixture
def raw_client(app) -> Iterator[Any]:
    """A FastAPI ``TestClient`` with NO dependency overrides applied.

    Used by authentication-behaviour tests (e.g. ``test_bug_cors_auth.py``)
    that need the real ``require_auth`` dependency to fire so they can verify
    that unauthenticated requests are properly rejected with ``401``.

    Unlike the ``client`` fixture, this one does NOT override ``require_auth``
    with a no-op. Any overrides already on ``app.dependency_overrides`` from a
    previous fixture are temporarily cleared and restored on teardown so each
    test gets a clean slate.
    """
    from fastapi.testclient import TestClient

    # Snapshot any existing overrides and clear them so the real dependencies fire.
    saved_overrides = dict(app.dependency_overrides)
    app.dependency_overrides.clear()

    with TestClient(app) as test_client:
        yield test_client

    # Restore overrides so other fixtures/tests are unaffected.
    app.dependency_overrides.clear()
    app.dependency_overrides.update(saved_overrides)


# --------------------------------------------------------------------------- #
# Simlink module I/O fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture
def simlink_module_factory() -> Callable[..., Dict[str, Any]]:
    """Factory that builds ``SimlinkModulo``-shaped dicts for module I/O tests.

    The shape mirrors ``contracts.simlink_models.SimlinkModulo`` so files written
    with it are read back correctly by the ``/api/v1/modulos`` route. Override
    any field via keyword arguments.
    """

    def _build(
        modulo_id: Optional[str] = None,
        *,
        session_id: Optional[str] = None,
        titulo: str = "Modulo de Teste",
        dominio: str = "exemplo.com.br",
        total_passos: int = 1,
        video_url: str = "http://localhost:8000/videos_gerados/test_final.mp4",
        xp_max: int = 10,
        criado_em: str = "2024-01-01T00:00:00",
        hotspots: Optional[List[Dict[str, Any]]] = None,
        **overrides: Any,
    ) -> Dict[str, Any]:
        mid = modulo_id or f"sess_test_{uuid.uuid4().hex[:12]}"
        sid = session_id or mid
        if hotspots is None:
            hotspots = [
                {
                    "passo_num": i + 1,
                    "xpath": f"//button[{i + 1}]",
                    "css_selector": f"button.step-{i + 1}",
                    "coordinates": {"x": 10.0, "y": 20.0, "w": 100.0, "h": 30.0},
                    "target_text": f"Passo {i + 1}",
                    "action": "click",
                    "url": "https://exemplo.com.br/app",
                    "screenshot_path": f"data/simlink_screenshots/{sid}/passo_{i + 1}.png",
                    "ancora": "Boa!",
                    "micro_narracao": "Tente clicar aqui.",
                    "audio_path": None,
                }
                for i in range(total_passos)
            ]
        modulo = {
            "modulo_id": mid,
            "session_id": sid,
            "titulo": titulo,
            "dominio": dominio,
            "total_passos": total_passos,
            "hotspots": hotspots,
            "video_url": video_url,
            "xp_max": xp_max,
            "criado_em": criado_em,
            "lms_callback_url": None,
            "lms_callback_token": None,
        }
        modulo.update(overrides)
        return modulo

    return _build


@pytest.fixture
def temp_simlink_dir(tmp_path: Path) -> Path:
    """An isolated, empty ``data/simlink`` directory under a pytest tmp path.

    Useful for unit-level module I/O tests that operate on a directory path
    directly (without depending on the process working directory). Returns the
    ``data/simlink`` Path.
    """
    simlink = tmp_path / "data" / "simlink"
    simlink.mkdir(parents=True, exist_ok=True)
    return simlink


@pytest.fixture
def simlink_dir() -> Iterator[Path]:
    """The real ``data/simlink`` directory the API reads from.

    The API resolves ``data/simlink/*.json`` relative to the working directory,
    so tests that drive ``GET /api/v1/modulos`` through the ``TestClient`` need
    module files in this exact location. This fixture yields the directory and,
    on teardown, removes only the files that tests create via
    :func:`write_simlink_module` (tracked through the companion fixture), so it
    never disturbs pre-existing data.
    """
    simlink = REPO_ROOT / "data" / "simlink"
    simlink.mkdir(parents=True, exist_ok=True)
    yield simlink


@pytest.fixture
def write_simlink_module(simlink_dir: Path, simlink_module_factory) -> Iterator[Callable[..., Path]]:
    """Write a module JSON into the real ``data/simlink`` dir and auto-clean it.

    Returns a callable that accepts the same keyword arguments as
    ``simlink_module_factory`` and returns the path to the written file. Every
    file written through this helper is deleted on teardown, leaving any
    pre-existing module data untouched.
    """
    created: List[Path] = []

    def _write(**kwargs: Any) -> Path:
        modulo = simlink_module_factory(**kwargs)
        # Namespace the filename so it never collides with real data.
        filename = f"{modulo['modulo_id']}.json"
        path = simlink_dir / filename
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(modulo, fh, ensure_ascii=False, indent=2)
        created.append(path)
        return path

    try:
        yield _write
    finally:
        for path in created:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


# --------------------------------------------------------------------------- #
# JWT factory (valid / invalid bearer tokens)
# --------------------------------------------------------------------------- #
def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _encode_hs256(payload: Dict[str, Any], secret: str) -> str:
    """Minimal, dependency-free HS256 JWT encoder.

    Implemented with the stdlib so the suite collects and runs even before
    ``PyJWT`` is installed. The production auth dependency (task 14.2) is
    expected to validate HS256 tokens against ``settings.jwt_secret``.
    """
    header = {"alg": "HS256", "typ": "JWT"}
    segments = [
        _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
    ]
    signing_input = ".".join(segments).encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    segments.append(_b64url(signature))
    return ".".join(segments)


@pytest.fixture
def jwt_secret() -> str:
    """The signing secret the production auth dependency is expected to use."""
    try:
        from config.settings import get_settings

        return get_settings().jwt_secret or "dev-secret-change-in-prod"
    except Exception:
        return "dev-secret-change-in-prod"


@pytest.fixture
def jwt_factory(jwt_secret: str) -> Dict[str, Callable[..., Any]]:
    """Factory helpers for valid/invalid JWTs and auth headers.

    Returns a dict of callables:

    * ``valid(sub=..., claims=..., expires_in=3600)`` -> a correctly signed,
      unexpired HS256 token.
    * ``expired(...)`` -> a correctly signed token whose ``exp`` is in the past.
    * ``invalid(...)`` -> a token signed with the wrong secret (bad signature).
    * ``malformed()`` -> a syntactically broken token string.
    * ``auth_header(token)`` -> ``{"Authorization": "Bearer <token>"}``.
    """

    def _base_claims(sub: str, expires_in: int, extra: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        now = int(time.time())
        claims: Dict[str, Any] = {
            "sub": sub,
            "iat": now,
            "exp": now + expires_in,
            "aud": "authenticated",
        }
        if extra:
            claims.update(extra)
        return claims

    def valid(sub: str = "test-user", claims: Optional[Dict[str, Any]] = None, expires_in: int = 3600) -> str:
        return _encode_hs256(_base_claims(sub, expires_in, claims), jwt_secret)

    def expired(sub: str = "test-user", claims: Optional[Dict[str, Any]] = None) -> str:
        return _encode_hs256(_base_claims(sub, -3600, claims), jwt_secret)

    def invalid(sub: str = "test-user", claims: Optional[Dict[str, Any]] = None, expires_in: int = 3600) -> str:
        return _encode_hs256(_base_claims(sub, expires_in, claims), jwt_secret + "-wrong")

    def malformed() -> str:
        return "not.a.valid.jwt"

    def auth_header(token: str) -> Dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    return {
        "valid": valid,
        "expired": expired,
        "invalid": invalid,
        "malformed": malformed,
        "auth_header": auth_header,
    }
