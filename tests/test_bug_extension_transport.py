"""Bug-condition exploration tests — Property 3 (Extension Endpoint & Transport).

Spec: production-hardening (bugfix). Task 2 / design.md Property 3.

These tests encode the *corrected* behavior for Property 3 and therefore MUST
FAIL on the current (unfixed) code — a failure here CONFIRMS the bug exists.
DO NOT "fix" these tests or the product code to make them pass; the same tests
are re-run unchanged after the Phase 1 fix (task 14.8) where they must PASS.

Bug condition C(X) for this property (design.md → Bug Details):

  C3(X): an extension request resolves the backend endpoint from the hardcoded
         "http://localhost:8000" value instead of configurable chrome.storage.
  C4(X): a finalized recording is uploaded as base64-in-JSON (single ingest POST)
         rather than as a binary upload (multipart/form-data / UploadFile).
  C5(X): capture events/screenshots are persisted to chrome.storage.local
         (~5 MB quota) instead of IndexedDB, so events are silently lost.

isBugCondition(X) = C3(X) OR C4(X) OR C5(X)

Validates: Requirements 1.3, 1.4, 1.5, 2.3, 2.4, 2.5
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKGROUND_JS = REPO_ROOT / "extension" / "background.js"

# chrome.storage.local default quota is ~5 MB.
CHROME_STORAGE_LOCAL_QUOTA_BYTES = 5 * 1024 * 1024


def _read_background_js() -> str:
    assert BACKGROUND_JS.exists(), f"extension/background.js not found at {BACKGROUND_JS}"
    return BACKGROUND_JS.read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# C3 — Extension backend endpoint must be configurable (not hardcoded localhost)
# --------------------------------------------------------------------------- #
def test_c3_extension_endpoint_not_hardcoded_localhost():
    """C3: background.js must resolve the backend from chrome.storage, with no
    hardcoded ``http://localhost:8000`` endpoint.

    EXPECTED ON UNFIXED CODE: FAILS — `const BACKEND_URL = "http://localhost:8000"`
    is hardcoded and used directly for every fetch().
    """
    content = _read_background_js()

    hardcoded = re.findall(r"https?://localhost:8000", content)
    assert not hardcoded, (
        "C3 counterexample: extension/background.js hardcodes the backend "
        f"endpoint {hardcoded!r}. The published extension will call the user's "
        "own machine instead of the deployed backend. The endpoint must be "
        "resolved from chrome.storage (a settings/options page), not hardcoded."
    )

    # The endpoint must be *read* from chrome.storage at request time, not just
    # written once from a hardcoded constant.
    reads_endpoint_from_storage = re.search(
        r"chrome\.storage\.(local|sync)\.get\([^)]*backendUrl", content
    )
    assert reads_endpoint_from_storage, (
        "C3 counterexample: extension/background.js never reads 'backendUrl' "
        "from chrome.storage at request time; the endpoint is not configurable."
    )


# --------------------------------------------------------------------------- #
# C4 — Ingest contract must accept a binary upload (not base64-in-JSON)
# --------------------------------------------------------------------------- #
# Generate "normally-large" recordings. The contract (not the byte count) is what
# the property checks, so a representative blob keeps the test fast while still
# exercising a real binary upload.
_recording_strategy = st.fixed_dictionaries(
    {
        "session_id": st.text(
            alphabet="abcdefghijklmnopqrstuvwxyz0123456789_", min_size=4, max_size=24
        ).map(lambda s: f"sess_{s}"),
        "video_bytes": st.binary(min_size=1024, max_size=64 * 1024),
        "modo_input": st.sampled_from(["A", "B"]),
    }
)


@settings(max_examples=8, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(recording=_recording_strategy)
def test_c4_ingest_accepts_binary_upload(client, recording):
    """C4: ``POST /api/v1/capture/ingest`` must accept the recording as a binary
    upload (multipart/form-data / UploadFile), not a base64 ``video_webm: str``.

    EXPECTED ON UNFIXED CODE: FAILS — the route binds an ``EventPayload`` JSON
    body whose ``video_webm`` is a base64 string, so a multipart binary upload
    is rejected (HTTP 422) rather than accepted.
    """
    files = {
        "video": (
            "recording.webm",
            io.BytesIO(recording["video_bytes"]),
            "video/webm",
        )
    }
    data = {
        "session_id": recording["session_id"],
        "modo_input": recording["modo_input"],
    }

    response = client.post("/api/v1/capture/ingest", files=files, data=data)

    assert response.status_code in (200, 201, 202), (
        "C4 counterexample: ingest rejected a binary multipart upload with "
        f"status {response.status_code} (session_id={recording['session_id']!r}, "
        f"{len(recording['video_bytes'])} video bytes). The route only accepts a "
        "base64 'video_webm: str' JSON field, which forces oversized base64-in-JSON "
        "payloads that time out / exhaust memory on long recordings."
    )


# --------------------------------------------------------------------------- #
# C5 — Capture events must be persisted in IndexedDB (not chrome.storage.local)
# --------------------------------------------------------------------------- #
def test_c5_capture_events_persisted_in_indexeddb():
    """C5: with ~50 × ~200 KB events (≈10 MB > the ~5 MB chrome.storage.local
    quota), events must be persisted in IndexedDB so none are silently lost.

    EXPECTED ON UNFIXED CODE: FAILS — events are appended to ``eventsLog`` in
    chrome.storage.local, which silently overflows its quota.
    """
    # Simulate the load that overflows the quota.
    num_events = 50
    bytes_per_event = 200 * 1024  # ~200 KB PNG screenshot per interaction
    simulated_total_bytes = num_events * bytes_per_event
    assert simulated_total_bytes > CHROME_STORAGE_LOCAL_QUOTA_BYTES, (
        "Test setup invalid: simulated event volume must exceed the "
        "chrome.storage.local quota to exercise C5."
    )

    content = _read_background_js()

    # The persistence target for events must be IndexedDB.
    uses_indexeddb = "indexedDB" in content
    persists_events_to_storage_local = re.search(
        r"chrome\.storage\.local\.set\(\s*\{[^}]*eventsLog", content
    )

    assert uses_indexeddb and not persists_events_to_storage_local, (
        "C5 counterexample: ~50 × ~200 KB events ≈ "
        f"{simulated_total_bytes / (1024 * 1024):.1f} MB exceeds the "
        f"{CHROME_STORAGE_LOCAL_QUOTA_BYTES / (1024 * 1024):.0f} MB "
        "chrome.storage.local quota, yet extension/background.js persists "
        "'eventsLog' via chrome.storage.local.set(...) and never uses IndexedDB "
        f"(uses_indexeddb={uses_indexeddb}). Events are silently lost."
    )
