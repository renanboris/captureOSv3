"""Preservation property tests — Property 2: Authorized Data-Route Behavior.

Production-hardening bugfix spec, Task 9 (wave 2, preservation).

**Validates: Requirements 3.1, 3.3, 3.5, 3.6**

Observation-first methodology
-----------------------------
These tests capture the BASELINE behavior of the UNFIXED code for *authorized*
data-route calls. The unfixed system has no auth gate, so every well-formed
request is, by construction, an "authorized" request that the baseline accepts —
exactly the ``NOT isBugCondition(X)`` slice this property covers. The later fix
(CORS lockdown in 14.1, auth dependency in 14.2) must, given valid auth from an
allowed origin, reproduce the SAME status code, body, and side effects recorded
here.

The data routes and their observed baselines (recorded by driving the unfixed
code directly before writing these assertions):

* ``POST /api/v1/capture/ingest`` -> ``200 {"status":"ok","session_id":...}`` and
  the decoupled export pipeline (``renderizar_exportacao``) is triggered once.
* ``GET /api/v1/session/{id}/roteiro`` -> ``404`` when absent, ``200`` with the
  persisted document when present.
* ``POST /api/v1/session/{id}/roteiro`` -> ``200 {"status":"ok"}``; with
  ``aprovado=true`` it persists the script and triggers
  ``rerenderizar_com_roteiro_aprovado`` once (3.3).
* ``POST /api/v1/session/{id}/passo/{n}/regerar`` -> ``200 {"passo": <passo>}``
  when the step exists, ``404`` otherwise.
* ``POST /api/v1/tts/preview`` -> ``200 {"audio_url": ".../artifacts/previews/
  preview_<hash>.mp3"}`` and ``gerar_audio`` is invoked.
* ``GET /api/v1/session/{id}/artifacts`` -> ``200`` with a fixed key set; a fresh
  session yields null asset URLs and ``status`` read from the status file.
* ``GET /api/v1/modulos`` -> ``200 {"modulos":[...],"total":n}`` (3.5).
* ``GET /api/v1/simlink/{id}`` -> ``200`` module / ``404`` when missing (3.5).
* ``POST /api/v1/simlink/{id}/conclusao`` -> ``200 {"status":"ok"}`` and fires the
  LMS callback iff the module is configured with one (3.5).
* ``POST /api/v1/sandbox/evaluate`` -> the arbiter result, or the
  ``{"is_correct": false, "hint": "Roteiro não encontrado"}`` short-circuit when
  no roteiro exists; ``POST /api/v1/sandbox/reset`` -> ``200 {"status":"ok"}`` (3.6).

The heavy side-effect boundaries (AI/GPU pipeline, TTS engine, Gemini arbiter,
LMS HTTP callback) are intercepted with recording probes so the route contract
is observed deterministically without the real subsystems.

These tests MUST PASS on unfixed code.
"""

from __future__ import annotations

import base64
import json
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from config.settings import get_settings

REPO_ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------- #
# Cleanup helpers — only remove files the tests themselves create.
# --------------------------------------------------------------------------- #
def _unlink(*paths: Path) -> None:
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def _status_file(session_id: str) -> Path:
    return REPO_ROOT / "data" / "status" / f"{session_id}.json"


def _roteiro_file(session_id: str) -> Path:
    return REPO_ROOT / "data" / "roteiros" / f"{session_id}.json"


def _roteiro_jsonl(session_id: str) -> Path:
    return REPO_ROOT / "data" / "roteiros" / f"{session_id}.jsonl"


def _simlink_file(modulo_id: str) -> Path:
    return REPO_ROOT / "data" / "simlink" / f"{modulo_id}.json"


def _simlink_resultado(modulo_id: str) -> Path:
    return REPO_ROOT / "data" / "simlink" / f"{modulo_id}_resultado.json"


def _sandbox_state_file(session_id: str) -> Path:
    return REPO_ROOT / "data" / "status" / f"sandbox_{session_id}.json"


# --------------------------------------------------------------------------- #
# Recording probes for the heavy side-effect boundaries.
# Each returns a *synchronous* callable that records its invocation immediately
# (so create_task/await scheduling is deterministic) and returns an awaitable
# resolving to ``return_value``.
# --------------------------------------------------------------------------- #
def _recording_coro(store: List[Dict[str, Any]], return_value: Any = None) -> Callable[..., Any]:
    def _probe(*args: Any, **kwargs: Any):
        store.append({"args": args, "kwargs": kwargs})

        async def _coro():
            return return_value

        return _coro()

    return _probe


def _install_pipeline_probes(monkeypatch):
    """Patch the ingest/approval pipeline triggers; return their call stores."""
    import api.main as main

    pipeline: List[Dict[str, Any]] = []
    rerender: List[Dict[str, Any]] = []
    monkeypatch.setattr(main, "renderizar_exportacao", _recording_coro(pipeline))
    monkeypatch.setattr(main, "rerenderizar_com_roteiro_aprovado", _recording_coro(rerender))
    return pipeline, rerender


def _new_session() -> str:
    return f"sess_p2_{uuid.uuid4().hex[:12]}"


def _new_modulo() -> str:
    return f"mod_p2_{uuid.uuid4().hex[:12]}"


# --------------------------------------------------------------------------- #
# Strategies — constrained to the authorized / non-bug-condition input space.
# --------------------------------------------------------------------------- #
_SAFE_TEXT = st.text(
    alphabet=st.characters(min_codepoint=32, max_codepoint=126),
    min_size=1,
    max_size=24,
)

_PASSO = st.fixed_dictionaries(
    {
        "passo": st.integers(min_value=1, max_value=20),
        "timestamp": st.integers(min_value=0, max_value=2_000_000_000_000),
        "ancora": _SAFE_TEXT,
        "micro_narracao": _SAFE_TEXT,
    }
)


# =========================================================================== #
# 3.1 — Authorized ingest accepts the capture and triggers the pipeline.
# =========================================================================== #
@settings(
    max_examples=10,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    video_bytes=st.binary(min_size=0, max_size=4096),
    modo=st.sampled_from(["A", "B"]),
)
def test_authorized_ingest_returns_ok_and_triggers_pipeline(client, monkeypatch, video_bytes, modo):
    """Baseline (3.1): an authorized ingest returns ``200 {"status":"ok",...}``
    and triggers the decoupled export pipeline exactly once.

    Uses multipart/form-data as per the task 14.4 contract change.
    """
    pipeline, _ = _install_pipeline_probes(monkeypatch)

    session_id = _new_session()
    data = {
        "session_id": session_id,
        "events": "[]",
        "audio_instrutor_webm": "",
        "modo_input": modo,
    }
    files = [("video", ("capture.webm", video_bytes, "video/webm"))]
    try:
        resp = client.post("/api/v1/capture/ingest", data=data, files=files)
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok", "session_id": session_id}
        assert len(pipeline) == 1
        assert pipeline[0]["args"][0]["session_id"] == session_id
    finally:
        _unlink(_status_file(session_id))


# =========================================================================== #
# 3.3 — Authorized script save persists and (when approved) triggers rerender.
# =========================================================================== #
@settings(
    max_examples=10,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(roteiro=st.lists(_PASSO, min_size=1, max_size=6))
def test_authorized_roteiro_save_read_and_approval(client, monkeypatch, roteiro):
    """Baseline (3.3): saving a script returns ``200 {"status":"ok"}`` and is
    persisted; reading it back returns the same roteiro; an ``aprovado=true`` save
    triggers ``rerenderizar_com_roteiro_aprovado`` exactly once."""
    _, rerender = _install_pipeline_probes(monkeypatch)

    session_id = _new_session()
    try:
        # Save without approval: 200 ok, no rerender, persisted to disk.
        resp = client.post(
            f"/api/v1/session/{session_id}/roteiro",
            json={"roteiro": roteiro, "aprovado": False},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        assert len(rerender) == 0

        # Read back: 200 with the persisted session_id + roteiro.
        resp = client.get(f"/api/v1/session/{session_id}/roteiro")
        assert resp.status_code == 200
        body = resp.json()
        assert body["session_id"] == session_id
        assert body["roteiro"] == roteiro

        # Approve: 200 ok and the post-approval re-render is triggered once.
        resp = client.post(
            f"/api/v1/session/{session_id}/roteiro",
            json={"roteiro": roteiro, "aprovado": True},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        assert len(rerender) == 1
        assert rerender[0]["args"][0] == session_id
        assert rerender[0]["args"][1] == roteiro
    finally:
        _unlink(_roteiro_file(session_id), _roteiro_jsonl(session_id), _status_file(session_id))


def test_authorized_get_roteiro_missing_returns_404(client):
    """Baseline (3.3): reading a script that was never saved returns ``404``."""
    session_id = _new_session()
    resp = client.get(f"/api/v1/session/{session_id}/roteiro")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Roteiro não encontrado"}


# =========================================================================== #
# 3.6 — Authorized regerar returns the regenerated step (or 404).
# =========================================================================== #
@settings(
    max_examples=8,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    n_passos=st.integers(min_value=1, max_value=6),
    pick=st.integers(min_value=0, max_value=100),
)
def test_authorized_regerar_existing_step(client, monkeypatch, n_passos, pick):
    """Baseline (3.6): regenerating an existing step returns ``200 {"passo": ...}``
    and invokes the regeneration engine once."""
    import api.intelligence_engine as ie

    calls: List[Dict[str, Any]] = []
    passo_num = (pick % n_passos) + 1
    regen_return = {"passo": passo_num, "ancora": "novo", "micro_narracao": "texto"}
    monkeypatch.setattr(ie, "regerar_passo_isolado", _recording_coro(calls, regen_return))

    session_id = _new_session()
    roteiro = [
        {"passo": i + 1, "timestamp": (i + 1) * 1000, "ancora": "a", "micro_narracao": "m"}
        for i in range(n_passos)
    ]
    rot_path = _roteiro_file(session_id)
    rot_path.parent.mkdir(parents=True, exist_ok=True)
    rot_path.write_text(
        json.dumps({"session_id": session_id, "roteiro": roteiro}, ensure_ascii=False),
        encoding="utf-8",
    )
    try:
        resp = client.post(f"/api/v1/session/{session_id}/passo/{passo_num}/regerar")
        assert resp.status_code == 200
        assert resp.json() == {"passo": regen_return}
        assert len(calls) == 1
    finally:
        _unlink(rot_path)


def test_authorized_regerar_missing_step_returns_404(client):
    """Baseline (3.6): regenerating a non-existent step returns ``404``."""
    session_id = _new_session()
    roteiro = [{"passo": 1, "timestamp": 1000, "ancora": "a", "micro_narracao": "m"}]
    rot_path = _roteiro_file(session_id)
    rot_path.parent.mkdir(parents=True, exist_ok=True)
    rot_path.write_text(
        json.dumps({"session_id": session_id, "roteiro": roteiro}, ensure_ascii=False),
        encoding="utf-8",
    )
    try:
        resp = client.post(f"/api/v1/session/{session_id}/passo/999/regerar")
        assert resp.status_code == 404
        assert resp.json() == {"detail": "Passo 999 não encontrado"}
    finally:
        _unlink(rot_path)


# =========================================================================== #
# 3.6 — Authorized TTS preview returns an audio URL and invokes the TTS engine.
# =========================================================================== #
@settings(
    max_examples=8,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(texto=_SAFE_TEXT)
def test_authorized_tts_preview_returns_audio_url(client, monkeypatch, texto):
    """Baseline (3.6): TTS preview returns ``200`` with an ``audio_url`` under the
    previews mount and invokes ``gerar_audio`` once."""
    import video_eng.tts_generator as ttsmod

    calls: List[Dict[str, Any]] = []
    monkeypatch.setattr(ttsmod, "gerar_audio", _recording_coro(calls, True))

    backend = get_settings().backend_url
    resp = client.post("/api/v1/tts/preview", json={"texto": texto})
    assert resp.status_code == 200
    audio_url = resp.json()["audio_url"]
    assert audio_url.startswith(f"{backend}/artifacts/previews/preview_")
    assert audio_url.endswith(".mp3")
    assert len(calls) == 1
    # The engine was asked to write to the same preview path the URL points at.
    written_path = Path(calls[0]["args"][1])
    assert written_path.name == audio_url.rsplit("/", 1)[-1]


def test_authorized_tts_preview_failure_returns_500(client, monkeypatch):
    """Baseline (3.6): when the TTS engine reports failure, the route returns
    ``500`` (observed error contract)."""
    import video_eng.tts_generator as ttsmod

    monkeypatch.setattr(ttsmod, "gerar_audio", _recording_coro([], False))
    resp = client.post("/api/v1/tts/preview", json={"texto": "qualquer"})
    assert resp.status_code == 500
    assert resp.json() == {"detail": "Falha ao gerar TTS"}


# =========================================================================== #
# 3.6 — Authorized artifacts listing returns the fixed key set.
# =========================================================================== #
def test_authorized_artifacts_fresh_session_baseline(client):
    """Baseline (3.6): for a fresh session, the artifacts route returns the fixed
    key set with null asset URLs, an empty quiz, and ``status`` from the status
    file (``processing`` when none exists)."""
    session_id = _new_session()
    try:
        resp = client.get(f"/api/v1/session/{session_id}/artifacts")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {
            "session_id",
            "video_url",
            "pdf_url",
            "transcript_url",
            "quiz",
            "simlink_url",
            "scorm_download_url",
            "scorm_player_url",
            "status",
        }
        assert body["session_id"] == session_id
        assert body["video_url"] is None
        assert body["pdf_url"] is None
        assert body["transcript_url"] is None
        assert body["quiz"] == []
        assert body["simlink_url"] is None
        assert body["scorm_download_url"] is None
        assert body["scorm_player_url"] is None
        assert body["status"] == "processing"
    finally:
        _unlink(_status_file(session_id))


# =========================================================================== #
# 3.5 — Authorized simlink module read + listing.
# =========================================================================== #
@settings(
    max_examples=8,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    titulo=_SAFE_TEXT,
    total_passos=st.integers(min_value=1, max_value=12),
    xp_max=st.integers(min_value=0, max_value=500),
)
def test_authorized_simlink_module_read_and_listing(
    client, simlink_module_factory, titulo, total_passos, xp_max
):
    """Baseline (3.5): a written module is returned verbatim by
    ``GET /api/v1/simlink/{id}`` and appears in ``GET /api/v1/modulos`` with the
    listing's documented summary shape."""
    modulo_id = _new_modulo()
    modulo = simlink_module_factory(
        modulo_id=modulo_id,
        titulo=titulo,
        total_passos=total_passos,
        xp_max=xp_max,
    )
    path = _simlink_file(modulo_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(modulo, ensure_ascii=False), encoding="utf-8")
    try:
        # Single-module fetch returns the stored module.
        resp = client.get(f"/api/v1/simlink/{modulo_id}")
        assert resp.status_code == 200
        assert resp.json()["modulo_id"] == modulo_id
        assert resp.json()["titulo"] == titulo

        # Listing includes the module with the summary projection.
        resp = client.get("/api/v1/modulos")
        assert resp.status_code == 200
        body = resp.json()
        # The response must at minimum contain "modulos" and "total"; pagination
        # fields ("count", "offset", "limit") may also be present after task 14.6.
        assert {"modulos", "total"} <= set(body.keys())
        assert body["total"] == len(body["modulos"])
        match = next((m for m in body["modulos"] if m["modulo_id"] == modulo_id), None)
        assert match is not None
        assert match["titulo"] == titulo
        assert match["total_passos"] == total_passos
        assert match["xp_max"] == xp_max
    finally:
        _unlink(path)


def test_authorized_simlink_missing_returns_404(client):
    """Baseline (3.5): fetching an unknown module returns ``404``."""
    resp = client.get(f"/api/v1/simlink/{_new_modulo()}")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Módulo Simlink não encontrado"}


# =========================================================================== #
# 3.5 — Authorized conclusao records the result and fires the LMS callback
#       iff the module is configured with one.
# =========================================================================== #
@settings(
    max_examples=8,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    xp=st.integers(min_value=0, max_value=100),
    completado=st.booleans(),
    lms_configured=st.booleans(),
)
def test_authorized_conclusao_records_and_conditionally_calls_lms(
    client, monkeypatch, simlink_module_factory, xp, completado, lms_configured
):
    """Baseline (3.5): recording a completion returns ``200 {"status":"ok"}`` and
    fires the LMS callback exactly when the module has a callback URL."""
    import simlink_eng.lms_callback as lmsmod

    lms_calls: List[Dict[str, Any]] = []
    monkeypatch.setattr(lmsmod, "reportar_conclusao_lms", _recording_coro(lms_calls, True))

    modulo_id = _new_modulo()
    overrides: Dict[str, Any] = {}
    if lms_configured:
        overrides = {"lms_callback_url": "https://lms.example/cb", "lms_callback_token": "tok"}
    else:
        overrides = {"lms_callback_url": None, "lms_callback_token": None}
    modulo = simlink_module_factory(modulo_id=modulo_id, xp_max=100, **overrides)
    path = _simlink_file(modulo_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(modulo, ensure_ascii=False), encoding="utf-8")
    try:
        resp = client.post(
            f"/api/v1/simlink/{modulo_id}/conclusao",
            json={"xp": xp, "completado": completado},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        # Completion result is always persisted.
        assert _simlink_resultado(modulo_id).exists()
        # LMS callback fires iff a callback URL was configured.
        if lms_configured:
            assert len(lms_calls) == 1
            assert lms_calls[0]["args"][0] == "https://lms.example/cb"
            assert lms_calls[0]["args"][2] == modulo_id
        else:
            assert len(lms_calls) == 0
    finally:
        _unlink(path, _simlink_resultado(modulo_id))


# =========================================================================== #
# 3.6 — Authorized sandbox evaluate / reset.
# =========================================================================== #
@settings(
    max_examples=8,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    target_text=_SAFE_TEXT,
    url=st.sampled_from(["https://a.example", "https://b.example/app"]),
)
def test_authorized_sandbox_evaluate_without_roteiro_short_circuits(
    client, monkeypatch, target_text, url
):
    """Baseline (3.6): evaluating a sandbox action with no roteiro on disk returns
    the ``Roteiro não encontrado`` short-circuit and never calls the arbiter."""
    import sandbox_eng.arbitro_engine as arb

    arbiter_calls: List[Dict[str, Any]] = []
    monkeypatch.setattr(
        arb, "avaliar_acao_sandbox", _recording_coro(arbiter_calls, {"is_correct": True, "hint": ""})
    )

    modulo_id = _new_modulo()
    try:
        resp = client.post(
            "/api/v1/sandbox/evaluate",
            json={"session_id": modulo_id, "url": url, "action_data": {"target_text": target_text}},
        )
        assert resp.status_code == 200
        assert resp.json() == {"is_correct": False, "hint": "Roteiro não encontrado"}
        assert len(arbiter_calls) == 0
    finally:
        _unlink(_sandbox_state_file(modulo_id), _simlink_file(modulo_id))


def test_authorized_sandbox_evaluate_with_roteiro_calls_arbiter_and_advances(client, monkeypatch):
    """Baseline (3.6): with a roteiro present, evaluate delegates to the arbiter,
    returns its verdict, and advances the sandbox step on a correct action."""
    import sandbox_eng.arbitro_engine as arb

    arbiter_calls: List[Dict[str, Any]] = []
    verdict = {"is_correct": True, "hint": ""}
    monkeypatch.setattr(arb, "avaliar_acao_sandbox", _recording_coro(arbiter_calls, verdict))

    modulo_id = _new_modulo()
    # No simlink file -> route uses modulo_id as the session_id for the roteiro.
    roteiro = [
        {"passo": 1, "timestamp": 1000, "ancora": "a", "micro_narracao": "m", "_simlink": {"target_text": "Salvar"}},
    ]
    rot_path = _roteiro_file(modulo_id)
    rot_path.parent.mkdir(parents=True, exist_ok=True)
    rot_path.write_text(
        json.dumps({"session_id": modulo_id, "roteiro": roteiro}, ensure_ascii=False),
        encoding="utf-8",
    )
    try:
        resp = client.post(
            "/api/v1/sandbox/evaluate",
            json={"session_id": modulo_id, "url": "https://x.example", "action_data": {"target_text": "Salvar"}},
        )
        assert resp.status_code == 200
        assert resp.json() == verdict
        assert len(arbiter_calls) == 1
        # Correct action advances the stored sandbox step to 2.
        state = json.loads(_sandbox_state_file(modulo_id).read_text(encoding="utf-8"))
        assert state["passo"] == 2
    finally:
        _unlink(rot_path, _sandbox_state_file(modulo_id))


@settings(
    max_examples=8,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(session_id=st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789_", min_size=1, max_size=20))
def test_authorized_sandbox_reset_returns_ok(client, session_id):
    """Baseline (3.6): resetting the sandbox always returns ``200 {"status":"ok"}``."""
    try:
        resp = client.post("/api/v1/sandbox/reset", json={"session_id": session_id})
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
    finally:
        _unlink(_sandbox_state_file(session_id))
