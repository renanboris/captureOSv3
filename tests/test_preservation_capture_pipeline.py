"""Preservation property tests — Property 4: Capture-to-Pipeline Result Equivalence.

Production-hardening bugfix spec, Task 10 (wave 2, preservation).

Observation-first methodology
-----------------------------
These tests capture the BASELINE behavior of the UNFIXED code for *non*-bug-condition
inputs — normally-sized captures in Modo A (auto narration) or Modo B (instructor
microphone). They record what the system does today so the later fix (binary /
pre-signed upload in task 14.4) can be proven to deliver a *semantically equivalent*
payload to ``renderizar_exportacao`` and to still expose the final video at the existing
``videos_gerados`` URL.

The observation points are deterministic and do not require the real AI/GPU pipeline:

* The ingest route hands a ``payload_dict`` to ``renderizar_exportacao`` (the decoupled
  pipeline trigger). We intercept that hand-off boundary and assert the delivered
  payload preserves ``session_id``, ``events``, video bytes, instructor audio, and
  ``modo_input``. This is exactly the "payload delivered to the backend is semantically
  equivalent" property.
* When a session is ``completed`` the status route exposes the final video at
  ``{backend_url}/videos_gerados/{session_id}_final.mp4``. We assert that URL contract.

The generators stay strictly inside ``NOT isBugCondition(X)``: only ``modo_input`` in
{"A", "B"} (Modo C is the C15 bug condition) and only normally-sized payloads (not the
oversized 400-800 MB base64 blobs of the C4 bug condition).

These tests MUST PASS on unfixed code.

**Validates: Requirements 3.1, 3.2, 3.4**
"""

from __future__ import annotations

import base64
import json
import uuid
from pathlib import Path
from typing import Any, Dict, List

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from config.settings import get_settings

REPO_ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _cleanup_session_files(session_id: str) -> None:
    """Remove the per-session status file the ingest/status routes write.

    Keeps the real ``data/status`` directory clean across many generated examples
    without disturbing pre-existing data.
    """
    candidates = [
        REPO_ROOT / "data" / "status" / f"{session_id}.json",
    ]
    for path in candidates:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def _install_pipeline_probe(monkeypatch) -> List[Dict[str, Any]]:
    """Intercept the ``renderizar_exportacao`` hand-off and record its payload.

    Replaces the pipeline coroutine with a probe that captures the exact dict the
    ingest route passes in (the real pipeline needs Gemini/GPU and is out of scope
    for a preservation observation). The probe still returns an awaitable so the
    route's ``asyncio.create_task`` scheduling behaves exactly as in production.
    """
    import api.main as main

    captured: List[Dict[str, Any]] = []

    def probe(payload: Dict[str, Any]):
        captured.append(payload)

        async def _noop() -> None:
            return None

        return _noop()

    monkeypatch.setattr(main, "renderizar_exportacao", probe)
    return captured


# --------------------------------------------------------------------------- #
# Strategies — constrained to the non-bug-condition input space
# --------------------------------------------------------------------------- #
_SAFE_TEXT = st.text(
    alphabet=st.characters(min_codepoint=32, max_codepoint=126),
    max_size=20,
)

_GEOMETRY = st.fixed_dictionaries(
    {
        "x": st.integers(min_value=0, max_value=1920),
        "y": st.integers(min_value=0, max_value=1080),
        "w": st.integers(min_value=1, max_value=500),
        "h": st.integers(min_value=1, max_value=300),
    }
)

_A11Y_NODE = st.fixed_dictionaries(
    {
        "som_id": st.integers(min_value=1, max_value=50),
        "tag": st.sampled_from(["button", "input", "a", "div"]),
        "geometry": _GEOMETRY,
    }
)

_EVENT = st.fixed_dictionaries(
    {
        "timestamp": st.integers(min_value=0, max_value=2_000_000_000_000),
        "type": st.sampled_from(["click", "input", "scroll"]),
        "eventData": st.fixed_dictionaries(
            {
                "action": st.sampled_from(["click", "type", "scroll"]),
                "target_tag": st.sampled_from(["BUTTON", "INPUT", "A"]),
                "target_text": _SAFE_TEXT,
                "a11y_tree": st.lists(_A11Y_NODE, max_size=3),
            }
        ),
        # Empty screenshot keeps the payload "normally-sized"; screenshot transport
        # is exercised by the C5 storage tests, not this capture->pipeline property.
        "screenshotData": st.just(""),
    }
)

# Normally-sized recordings: a handful of KB, never the oversized C4 blobs.
_VIDEO_BYTES = st.binary(min_size=0, max_size=8192)
_AUDIO_BYTES = st.binary(min_size=0, max_size=4096)
_EVENTS = st.lists(_EVENT, max_size=5)


# --------------------------------------------------------------------------- #
# Property test — capture -> pipeline payload equivalence (Modo A and Modo B)
# --------------------------------------------------------------------------- #
@settings(
    max_examples=10,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    video_bytes=_VIDEO_BYTES,
    audio_bytes=_AUDIO_BYTES,
    events=_EVENTS,
    modo=st.sampled_from(["A", "B"]),
)
def test_ingest_triggers_pipeline_with_equivalent_payload(
    client, monkeypatch, video_bytes, audio_bytes, events, modo
):
    """For any normally-sized Modo A/B capture, ingest triggers the pipeline once
    with a payload semantically equivalent to what was submitted.

    Task 14.4 changed the ingest route to accept multipart/form-data (binary
    upload) instead of JSON/base64. The preservation property is about semantic
    equivalence of the payload delivered to the pipeline, not wire format — so
    we send multipart and assert the pipeline receives the raw bytes intact.
    """
    captured = _install_pipeline_probe(monkeypatch)

    session_id = f"sess_pres_{uuid.uuid4().hex[:12]}"
    # Modo A = auto narration (no instructor mic); Modo B = instructor microphone.
    data = {
        "session_id": session_id,
        "recording_start_time": "1700000000000",
        "events": json.dumps(events),
        "modo_input": modo,
    }
    files = [("video", ("capture.webm", video_bytes, "video/webm"))]
    if modo == "B":
        files.append(("audio", ("audio.webm", audio_bytes, "audio/webm")))

    try:
        response = client.post("/api/v1/capture/ingest", data=data, files=files)

        # Baseline (3.1): ingest accepts the capture and acknowledges the session.
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["session_id"] == session_id

        # Baseline (3.1): the decoupled export pipeline is triggered exactly once.
        assert len(captured) == 1
        delivered = captured[0]

        # Baseline (3.4): the delivered payload is semantically equivalent.
        assert delivered["session_id"] == session_id
        assert delivered["events"] == events
        assert delivered["modo_input"] == modo
        # Video bytes survive the hand-off intact (now as raw bytes, not base64).
        assert delivered["video_bytes"] == video_bytes
        # Modo B preserves the instructor audio; Modo A carries none.
        expected_audio = audio_bytes if modo == "B" else b""
        assert delivered["audio_bytes"] == expected_audio
    finally:
        _cleanup_session_files(session_id)


# --------------------------------------------------------------------------- #
# Property test — final video exposed at the existing videos_gerados URL (3.2)
# --------------------------------------------------------------------------- #
@settings(
    max_examples=8,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    suffix=st.text(
        alphabet="abcdefghijklmnopqrstuvwxyz0123456789",
        min_size=4,
        max_size=12,
    )
)
def test_completed_session_exposes_videos_gerados_url(client, suffix):
    """For any completed session, the status route exposes the final video at the
    existing ``videos_gerados`` URL."""
    from api.status_manager import update_status

    app_settings = get_settings()
    session_id = f"sess_pres_url_{suffix}"
    expected_url = f"{app_settings.backend_url}/videos_gerados/{session_id}_final.mp4"

    try:
        update_status(session_id, "completed", "done")
        response = client.get(f"/api/v1/capture/status/{session_id}")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "completed"
        assert body["url"] == expected_url
        assert body["url"].endswith(f"/videos_gerados/{session_id}_final.mp4")
    finally:
        _cleanup_session_files(session_id)


# --------------------------------------------------------------------------- #
# Unit tests — explicit Modo A / Modo B examples
# --------------------------------------------------------------------------- #
def test_modo_a_capture_triggers_pipeline_with_auto_narration(client, monkeypatch):
    """Modo A (auto narration): no instructor audio, pipeline triggered with the
    submitted events and video bytes intact.

    Uses multipart/form-data as per task 14.4 contract.
    """
    captured = _install_pipeline_probe(monkeypatch)

    session_id = f"sess_pres_modo_a_unit_{uuid.uuid4().hex[:8]}"
    video_bytes = b"\x00\x01webm-modo-a\xff"
    events = [
        {
            "timestamp": 1700000000001,
            "type": "click",
            "eventData": {
                "action": "click",
                "target_tag": "BUTTON",
                "target_text": "Salvar",
                "a11y_tree": [
                    {"som_id": 1, "tag": "button", "geometry": {"x": 10, "y": 10, "w": 100, "h": 30}}
                ],
            },
            "screenshotData": "",
        }
    ]
    data = {
        "session_id": session_id,
        "events": json.dumps(events),
        "modo_input": "A",
    }
    files = [("video", ("capture.webm", video_bytes, "video/webm"))]

    try:
        response = client.post("/api/v1/capture/ingest", data=data, files=files)
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "session_id": session_id}

        assert len(captured) == 1
        delivered = captured[0]
        assert delivered["modo_input"] == "A"
        assert delivered["session_id"] == session_id
        assert delivered["events"] == events
        assert delivered["video_bytes"] == video_bytes
        assert delivered["audio_bytes"] == b""
    finally:
        _cleanup_session_files(session_id)


def test_modo_b_capture_preserves_instructor_audio(client, monkeypatch):
    """Modo B (instructor microphone): the instructor audio bytes are delivered to
    the pipeline alongside the video and events.

    Uses multipart/form-data as per task 14.4 contract.
    """
    captured = _install_pipeline_probe(monkeypatch)

    session_id = f"sess_pres_modo_b_unit_{uuid.uuid4().hex[:8]}"
    video_bytes = b"webm-modo-b-bytes"
    audio_bytes = b"instructor-audio-bytes"
    data = {
        "session_id": session_id,
        "events": "[]",
        "modo_input": "B",
    }
    files = [
        ("video", ("capture.webm", video_bytes, "video/webm")),
        ("audio", ("audio.webm", audio_bytes, "audio/webm")),
    ]

    try:
        response = client.post("/api/v1/capture/ingest", data=data, files=files)
        assert response.status_code == 200
        assert response.json()["session_id"] == session_id

        assert len(captured) == 1
        delivered = captured[0]
        assert delivered["modo_input"] == "B"
        assert delivered["video_bytes"] == video_bytes
        assert delivered["audio_bytes"] == audio_bytes
    finally:
        _cleanup_session_files(session_id)
