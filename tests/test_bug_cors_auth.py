"""Bug-condition exploration test — Property 1: CORS and Authentication Lockdown.

Spec: ``.kiro/specs/production-hardening`` (bugfix), Task 1 / Property 1.

**Validates: Requirements 1.1, 1.2, 2.1, 2.2**

This is an *exploratory bug-condition* test. It encodes the EXPECTED (fixed)
behavior for inputs where the bug condition holds:

    isBugCondition(X) where C1(X) OR C2(X)
      C1: X is a cross-origin request AND CORS allows "*" together with
          allow_credentials=true
      C2: X targets a data route AND X carries no valid authentication AND the
          request is processed

Property 1 (design.md): for any request that is cross-origin from a non-allowed
origin (C1) or targets a data route without valid authentication (C2), the fixed
system SHALL reject it — rejecting disallowed origins at the CORS layer and
returning ``401 Unauthorized`` for unauthenticated data-route requests — and
SHALL never combine a wildcard origin with credentialed access.

CRITICAL: On the UNFIXED code this test is EXPECTED TO FAIL. The failure is the
success signal — it confirms C1 (CORS ``*`` + credentials) and C2 (unauthenticated
data routes) are real. DO NOT fix the test or the product code from here; the fix
lands later (tasks 14.1 / 14.2) and is re-verified by task 14.8.
"""

from __future__ import annotations

import glob
import os
from typing import Any, Callable, Dict, List, Tuple

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

# --------------------------------------------------------------------------- #
# Data-route registry (per design.md "Data route" glossary entry).
#
# Each entry: (method, path_template, request_kwargs). ``{sid}`` is filled with a
# test session id. Bodies are the minimal shape each route's Pydantic model
# accepts, so that on UNFIXED code the route is actually *processed* (the C2
# defect) rather than rejected for an unrelated validation reason.
# --------------------------------------------------------------------------- #
TEST_SID = "proptest_authcheck_sess"

DATA_ROUTES: List[Tuple[str, str, Dict[str, Any]]] = [
    ("POST", "/api/v1/capture/ingest", {"json": {"session_id": TEST_SID, "events": []}}),
    ("GET", "/api/v1/session/{sid}/roteiro", {}),
    ("POST", "/api/v1/session/{sid}/roteiro",
        {"json": {"roteiro": [], "modo_input": "A", "aprovado": False}}),
    ("POST", "/api/v1/session/{sid}/passo/1/regerar", {}),
    ("POST", "/api/v1/tts/preview", {"json": {"texto": "ola"}}),
    ("GET", "/api/v1/session/{sid}/artifacts", {}),
    ("GET", "/api/v1/simlink/{sid}", {}),
    ("GET", "/api/v1/modulos", {}),
    ("POST", "/api/v1/simlink/{sid}/conclusao", {"json": {"xp": 0, "completado": True}}),
    ("POST", "/api/v1/sandbox/evaluate",
        {"json": {"session_id": TEST_SID, "url": "https://example.com", "action_data": {}}}),
    ("POST", "/api/v1/sandbox/reset", {"json": {"session_id": TEST_SID}}),
]

# Auth states that are all "not valid authentication". A hardened data route must
# answer every one of these with 401.
NON_VALID_AUTH_STATES = ["none", "malformed", "invalid", "expired"]

DISALLOWED_ORIGIN = "https://evil.example"


def _headers_for_auth_state(state: str, jwt_factory: Dict[str, Callable[..., Any]]) -> Dict[str, str]:
    if state == "none":
        return {}
    if state == "malformed":
        return jwt_factory["auth_header"](jwt_factory["malformed"]())
    if state == "invalid":
        return jwt_factory["auth_header"](jwt_factory["invalid"]())
    if state == "expired":
        return jwt_factory["auth_header"](jwt_factory["expired"]())
    raise ValueError(f"unknown auth state: {state}")


# --------------------------------------------------------------------------- #
# Side-effect isolation fixture
#
# On UNFIXED code the data routes are processed, which spins up the export /
# re-render pipelines and writes status/roteiro/simlink files. We patch the
# pipeline triggers with spies (no GPU/AI/network work) and clean up any files
# the processed routes leave behind, so this exploratory test stays hermetic.
# --------------------------------------------------------------------------- #
@pytest.fixture
def pipeline_spy(monkeypatch) -> Dict[str, bool]:
    import api.main as main

    called = {"ingest_pipeline": False, "rerender_pipeline": False}

    async def _async_noop(*_a, **_k):
        return None

    def _spy_render(_payload):
        called["ingest_pipeline"] = True
        return _async_noop()

    async def _spy_rerender(_session_id, _roteiro):
        called["rerender_pipeline"] = True

    async def _spy_tts(_texto, _filepath):  # avoid real TTS provider calls
        return False

    async def _spy_arbitro(*_a, **_k):  # avoid real sandbox AI calls
        return {"is_correct": False, "hint": ""}

    monkeypatch.setattr(main, "renderizar_exportacao", _spy_render, raising=True)
    monkeypatch.setattr(main, "rerenderizar_com_roteiro_aprovado", _spy_rerender, raising=True)
    monkeypatch.setattr("video_eng.tts_generator.gerar_audio", _spy_tts, raising=False)
    monkeypatch.setattr("sandbox_eng.arbitro_engine.avaliar_acao_sandbox", _spy_arbitro, raising=False)

    yield called

    # Clean up any artifacts the processed (unfixed) routes may have written.
    for pattern in (
        f"data/status/{TEST_SID}.json",
        f"data/roteiros/{TEST_SID}.json",
        f"data/simlink/{TEST_SID}_resultado.json",
        f"data/status/sandbox_{TEST_SID}.json",
    ):
        for path in glob.glob(pattern):
            try:
                os.remove(path)
            except OSError:
                pass


# --------------------------------------------------------------------------- #
# C1 — CORS lockdown
# --------------------------------------------------------------------------- #
def test_cors_never_pairs_wildcard_origin_with_credentials(app):
    """Config-level: the CORS middleware must never combine ``*`` with credentials.

    EXPECTED ON UNFIXED CODE: FAILS — ``api/main.py`` configures
    ``allow_origins=["*"]`` together with ``allow_credentials=True``.
    """
    cors_configs = [
        mw.kwargs
        for mw in app.user_middleware
        if mw.cls.__name__ == "CORSMiddleware"
    ]
    assert cors_configs, "CORSMiddleware is not configured on the app"

    for kwargs in cors_configs:
        allow_origins = kwargs.get("allow_origins", [])
        allow_credentials = kwargs.get("allow_credentials", False)
        assert not ("*" in allow_origins and allow_credentials), (
            "CORS pairs wildcard origin '*' with allow_credentials=True "
            f"(allow_origins={allow_origins!r}, allow_credentials={allow_credentials!r})"
        )


def test_cors_disallowed_origin_is_not_accepted(client):
    """Behavioral: a credentialed cross-origin request from a disallowed origin
    must NOT be granted access, and the response must never echo the wildcard or
    the disallowed origin as an allowed credentialed origin.

    EXPECTED ON UNFIXED CODE: FAILS — Starlette reflects ``https://evil.example``
    into ``access-control-allow-origin`` with ``access-control-allow-credentials: true``.
    """
    client.cookies.set("session", "fake-credential")
    resp = client.get(
        "/api/v1/modulos",
        headers={"Origin": DISALLOWED_ORIGIN},
    )
    acao = resp.headers.get("access-control-allow-origin")
    acac = resp.headers.get("access-control-allow-credentials")

    assert acao != DISALLOWED_ORIGIN, (
        f"disallowed origin was accepted (access-control-allow-origin={acao!r})"
    )
    # If credentials are allowed, the origin must be a concrete allow-listed
    # value, never the wildcard.
    if acac == "true":
        assert acao != "*", "wildcard origin returned together with allow-credentials=true"


def test_cors_preflight_rejects_disallowed_origin(client):
    """A CORS preflight from a disallowed origin must not be granted.

    EXPECTED ON UNFIXED CODE: FAILS — preflight reflects the disallowed origin.
    """
    resp = client.options(
        "/api/v1/capture/ingest",
        headers={
            "Origin": DISALLOWED_ORIGIN,
            "Access-Control-Request-Method": "POST",
        },
    )
    acao = resp.headers.get("access-control-allow-origin")
    assert acao != DISALLOWED_ORIGIN, (
        f"preflight accepted disallowed origin (access-control-allow-origin={acao!r})"
    )
    assert acao != "*", "preflight returned wildcard origin"


# --------------------------------------------------------------------------- #
# C2 — Authentication on all data routes (property-based over routes + auth states)
# --------------------------------------------------------------------------- #
@settings(
    max_examples=12,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    route_idx=st.integers(min_value=0, max_value=len(DATA_ROUTES) - 1),
    auth_state=st.sampled_from(NON_VALID_AUTH_STATES),
)
def test_unauthenticated_data_routes_return_401(
    raw_client, jwt_factory, pipeline_spy, route_idx, auth_state
):
    """For ALL data routes and ALL non-valid auth states, the response is 401.

    Uses ``raw_client`` (no require_auth override) so the real auth dependency
    fires and unauthenticated requests are properly rejected.

    EXPECTED ON UNFIXED CODE: FAILS — no auth gate exists, so routes are
    processed and return 200/404/422/500, never 401.
    """
    method, path_template, kwargs = DATA_ROUTES[route_idx]
    path = path_template.format(sid=TEST_SID)
    headers = _headers_for_auth_state(auth_state, jwt_factory)

    resp = raw_client.request(method, path, headers=headers, **kwargs)

    assert resp.status_code == 401, (
        f"{method} {path} with auth_state={auth_state!r} returned "
        f"{resp.status_code}, expected 401 (unauthenticated data route was processed)"
    )


# --------------------------------------------------------------------------- #
# C2 — Unauthenticated mutations must NOT trigger the pipelines
# --------------------------------------------------------------------------- #
def test_unauthenticated_ingest_does_not_trigger_pipeline(raw_client, pipeline_spy):
    """``POST /api/v1/capture/ingest`` with no auth must be rejected (401) and
    must NOT trigger ``renderizar_exportacao``.

    Uses ``raw_client`` (no require_auth override) so the real auth dependency fires.

    EXPECTED ON UNFIXED CODE: FAILS — returns 200 and triggers the export pipeline.
    """
    resp = raw_client.post(
        "/api/v1/capture/ingest",
        json={"session_id": TEST_SID, "events": []},
    )
    assert resp.status_code == 401, (
        f"anonymous ingest returned {resp.status_code}, expected 401"
    )
    assert pipeline_spy["ingest_pipeline"] is False, (
        "anonymous ingest triggered renderizar_exportacao (export pipeline)"
    )


def test_unauthenticated_roteiro_approval_does_not_trigger_rerender(raw_client, pipeline_spy):
    """``POST /api/v1/session/{id}/roteiro?aprovado=true`` with no auth must be
    rejected (401) and must NOT trigger ``rerenderizar_com_roteiro_aprovado``.

    Uses ``raw_client`` (no require_auth override) so the real auth dependency fires.

    EXPECTED ON UNFIXED CODE: FAILS — returns 200 and triggers the re-render pipeline.
    """
    resp = raw_client.post(
        f"/api/v1/session/{TEST_SID}/roteiro?aprovado=true",
        json={"roteiro": [{"passo": 1}], "modo_input": "A", "aprovado": True},
    )
    assert resp.status_code == 401, (
        f"anonymous roteiro approval returned {resp.status_code}, expected 401"
    )
    assert pipeline_spy["rerender_pipeline"] is False, (
        "anonymous roteiro approval triggered rerenderizar_com_roteiro_aprovado"
    )
