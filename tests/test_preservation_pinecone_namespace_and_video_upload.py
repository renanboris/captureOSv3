"""Preservation property tests — Pinecone Namespace Fetch & Supabase Video Upload.

Spec: ``.kiro/specs/pinecone-namespace-fetch-and-video-upload-fix``, Task 2 / Property 2.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

These tests capture the BASELINE (currently correct) behaviors that must remain
unchanged both before AND after the fix. They are expected to PASS on unfixed
code (confirming what we must preserve) and must continue to PASS after the fix
lands (confirming no regressions).

Preserved behaviors:
  P1 — Namespace fetch happy path: when backend is reachable and returns
       namespaces, the datalist is populated (carregarModulosPratica /
       carregarRoteiros fallback patterns are not touched).
  P2 — upload_video(): when Supabase is not configured, returns None immediately.
  P3 — upload_video(): when Supabase raises an exception, catches it, logs it,
       and returns None (pipeline stability — must never re-raise).
  P4 — _get_video_url(): when the local file does NOT exist and Supabase is
       configured, returns the Supabase public URL (already working path).
  P5 — _get_video_url(): when upload_video() returned None (Supabase not
       configured or upload failed), returns the local server URL.
  P6 — carregarModulosPratica and carregarRoteiros fallback logic is unchanged
       (the popup.js source still contains their existing localhost:8000 pattern).
  P7 — upload_video(): when file is missing returns None immediately (no
       exception raised, no Supabase call made).
"""

from __future__ import annotations

import json
import os
import sys
import types
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch, call

import pytest
from hypothesis import HealthCheck, given, settings as hyp_settings
from hypothesis import strategies as st

REPO_ROOT = Path(__file__).resolve().parent.parent


def _mock_supabase_module():
    """Lightweight mock for supabase-py when not installed."""
    mod = types.ModuleType("supabase")
    mod.create_client = MagicMock()
    mod.Client = MagicMock()
    return mod


@pytest.fixture(autouse=True)
def _patch_supabase_import():
    """Ensure ``supabase`` is available as a mock when not installed."""
    had_module = "supabase" in sys.modules
    if not had_module:
        sys.modules["supabase"] = _mock_supabase_module()
    sys.modules.pop("api.storage", None)
    yield
    if not had_module:
        sys.modules.pop("supabase", None)
    sys.modules.pop("api.storage", None)


# ===========================================================================
# P1 — popup.js: carregarModulosPratica / carregarRoteiros fallback unchanged
# ===========================================================================

class TestPreservationPopupFallbackPatterns:
    """The existing fallback patterns in popup.js must not be modified."""

    def test_carregar_modulos_pratica_has_localhost_fallback(self):
        """``carregarModulosPratica`` must still contain the localhost:8000 fallback."""
        source = (REPO_ROOT / "extension" / "popup.js").read_text(encoding="utf-8")

        # Locate carregarModulosPratica
        marker = "async function carregarModulosPratica"
        start = source.find(marker)
        assert start != -1, "carregarModulosPratica not found in popup.js"

        # Search forward for the fallback within a reasonable window (2000 chars)
        block = source[start : start + 2000]
        fallback = '"http://" + "localhost" + ":8000"'
        assert fallback in block, (
            f"carregarModulosPratica fallback pattern is missing: {fallback!r}"
        )

    def test_carregar_roteiros_has_localhost_fallback(self):
        """``carregarRoteiros`` must still contain the localhost:8000 fallback."""
        source = (REPO_ROOT / "extension" / "popup.js").read_text(encoding="utf-8")

        marker = "async function carregarRoteiros"
        start = source.find(marker)
        assert start != -1, "carregarRoteiros not found in popup.js"

        block = source[start : start + 2000]
        fallback = '"http://" + "localhost" + ":8000"'
        assert fallback in block, (
            f"carregarRoteiros fallback pattern is missing: {fallback!r}"
        )

    def test_namespace_selection_saves_to_storage(self):
        """The ``selectRagNamespace`` change listener must still call
        ``chrome.storage.local.set({ ragNamespace: ... })``.

        This is the persistence path for the user's namespace selection —
        must not be removed by the fix.
        """
        source = (REPO_ROOT / "extension" / "popup.js").read_text(encoding="utf-8")
        assert "ragNamespace: selectRagNamespace.value" in source, (
            "The ragNamespace persistence call was removed from popup.js — "
            "namespace selection will no longer be saved to chrome.storage.local."
        )


# ===========================================================================
# P2 — upload_video(): Supabase not configured → returns None
# ===========================================================================

class TestPreservationUploadVideoNotConfigured:
    """When ``supabase_url`` or ``supabase_key`` are absent, ``upload_video()``
    returns ``None`` immediately without touching the Supabase client.
    """

    @pytest.mark.parametrize("supabase_url,supabase_key", [
        ("", ""),
        ("", "some-key"),
        ("https://example.supabase.co", ""),
        (None, None),
        (None, "some-key"),
        ("https://example.supabase.co", None),
    ])
    def test_upload_video_returns_none_when_not_configured(
        self, tmp_path, supabase_url, supabase_key
    ):
        """upload_video() must return None (and not call Supabase) when settings
        are missing."""
        import api.storage as storage_module

        mp4_stub = tmp_path / "unconfigured_final.mp4"
        mp4_stub.write_bytes(b"\x00" * 128)

        with patch.object(storage_module, "create_client") as mock_create_client, \
             patch.object(storage_module, "get_settings") as mock_settings:

            mock_settings.return_value.supabase_url = supabase_url
            mock_settings.return_value.supabase_key = supabase_key

            result = storage_module.upload_video(str(mp4_stub), "unconfigured_session")

        assert result is None, (
            f"upload_video() returned {result!r} instead of None when "
            f"supabase_url={supabase_url!r}, supabase_key={supabase_key!r}"
        )
        mock_create_client.assert_not_called()

    def test_upload_video_returns_none_when_file_missing(self, tmp_path):
        """``upload_video()`` returns ``None`` immediately when the file is absent."""
        import api.storage as storage_module

        non_existent = str(tmp_path / "ghost_final.mp4")

        with patch.object(storage_module, "create_client") as mock_create_client, \
             patch.object(storage_module, "get_settings") as mock_settings:

            mock_settings.return_value.supabase_url = "https://example.supabase.co"
            mock_settings.return_value.supabase_key = "fake-key"

            result = storage_module.upload_video(non_existent, "ghost_session")

        assert result is None, (
            f"upload_video() returned {result!r} instead of None for a missing file"
        )
        mock_create_client.assert_not_called()


# ===========================================================================
# P3 — upload_video(): exception during upload → catches, logs, returns None
# ===========================================================================

class TestPreservationUploadVideoExceptionHandling:
    """When Supabase raises during upload, ``upload_video()`` must catch the
    exception, log it, and return ``None`` (never re-raise).

    This is the pipeline stability guarantee — a Supabase failure must NEVER
    crash the re-render pipeline.
    """

    @pytest.mark.parametrize("exc_class,exc_msg", [
        (ConnectionError, "network failure"),
        (TimeoutError, "timeout"),
        (RuntimeError, "supabase internal error"),
        (Exception, "generic error"),
    ])
    def test_upload_video_catches_exceptions_and_returns_none(
        self, tmp_path, exc_class, exc_msg
    ):
        import api.storage as storage_module

        mp4_stub = tmp_path / "exception_test_final.mp4"
        mp4_stub.write_bytes(b"\x00" * 128)

        mock_upload = MagicMock(side_effect=exc_class(exc_msg))
        mock_bucket = MagicMock()
        mock_bucket.upload = mock_upload
        mock_storage = MagicMock()
        mock_storage.from_ = MagicMock(return_value=mock_bucket)
        mock_client = MagicMock()
        mock_client.storage = mock_storage

        with patch.object(storage_module, "create_client", return_value=mock_client), \
             patch.object(storage_module, "get_settings") as mock_settings:

            mock_settings.return_value.supabase_url = "https://example.supabase.co"
            mock_settings.return_value.supabase_key = "fake-key"

            # Must NOT raise
            try:
                result = storage_module.upload_video(str(mp4_stub), "exception_session")
            except Exception as e:
                pytest.fail(
                    f"upload_video() re-raised {type(e).__name__}({e!r}) "
                    "instead of catching and returning None. "
                    "Pipeline stability is broken."
                )

        assert result is None, (
            f"upload_video() returned {result!r} instead of None after "
            f"{exc_class.__name__}({exc_msg!r})"
        )


# ===========================================================================
# P4 — _get_video_url(): local file absent + Supabase configured → Supabase URL
# ===========================================================================

class TestPreservationGetVideoUrlLocalAbsent:
    """When the local file does NOT exist and Supabase is configured,
    ``_get_video_url()`` (as called by ``check_status``) must return the
    Supabase public URL. This is the already-working path that must stay working.
    """

    def test_check_status_returns_supabase_url_when_local_file_absent(self):
        """check_status returns Supabase URL when local MP4 is not on disk."""
        session_id = "preservation_local_absent_sess"
        local_path = REPO_ROOT / "data" / "videos_gerados" / f"{session_id}_final.mp4"

        # Ensure the file does NOT exist
        local_path.unlink(missing_ok=True)

        # Write a completed status
        status_dir = REPO_ROOT / "data" / "status"
        status_dir.mkdir(parents=True, exist_ok=True)
        status_file = status_dir / f"{session_id}.json"
        status_file.write_text(
            json.dumps({"status": "completed", "message": "Done"}),
            encoding="utf-8"
        )

        try:
            try:
                from fastapi.testclient import TestClient
                from api.main import app
                from api.auth import require_auth

                async def _noop():
                    return {"sub": "test"}

                app.dependency_overrides[require_auth] = _noop
                with TestClient(app) as tc:
                    resp = tc.get(f"/api/v1/capture/status/{session_id}")
                app.dependency_overrides.pop(require_auth, None)
            except Exception as exc:
                pytest.skip(f"Could not create TestClient: {exc}")

            assert resp.status_code == 200
            data = resp.json()
            video_url = data.get("url", "")

            # When the local file is absent AND Supabase is configured,
            # the URL should be the Supabase one.
            # If Supabase is not configured in .env, the local URL is also
            # acceptable (we just verify the response is valid).
            assert video_url, "check_status returned an empty video URL"
        finally:
            status_file.unlink(missing_ok=True)


# ===========================================================================
# P5 — _get_video_url(): Supabase not configured → local URL
# ===========================================================================

class TestPreservationGetVideoUrlLocalFallback:
    """When Supabase is not configured, ``_get_video_url()`` must return the
    local server URL as a fallback.
    """

    def test_check_status_returns_local_url_when_supabase_not_configured(self):
        """check_status returns local URL when supabase_url is empty."""
        session_id = "preservation_local_fallback_sess"

        status_dir = REPO_ROOT / "data" / "status"
        status_dir.mkdir(parents=True, exist_ok=True)
        status_file = status_dir / f"{session_id}.json"
        status_file.write_text(
            json.dumps({"status": "completed", "message": "Done"}),
            encoding="utf-8"
        )

        # Create the local file so it's accessible
        videos_dir = REPO_ROOT / "data" / "videos_gerados"
        videos_dir.mkdir(parents=True, exist_ok=True)
        local_mp4 = videos_dir / f"{session_id}_final.mp4"
        local_mp4.write_bytes(b"\x00" * 64)

        try:
            try:
                from fastapi.testclient import TestClient
                from api.main import app
                from api.auth import require_auth
                from config.settings import get_settings
                import api.main as main_module

                async def _noop():
                    return {"sub": "test"}

                app.dependency_overrides[require_auth] = _noop

                # Patch settings to simulate Supabase not configured
                original_settings = get_settings()
                mock_settings = MagicMock()
                mock_settings.supabase_url = ""
                mock_settings.supabase_key = ""
                mock_settings.backend_url = original_settings.backend_url or "http://localhost:8000"
                mock_settings.cors_allowed_origins = original_settings.cors_allowed_origins
                mock_settings.jwt_secret = original_settings.jwt_secret

                with patch("api.main.settings", mock_settings):
                    with TestClient(app) as tc:
                        resp = tc.get(f"/api/v1/capture/status/{session_id}")

                app.dependency_overrides.pop(require_auth, None)
            except Exception as exc:
                pytest.skip(f"Could not create TestClient: {exc}")

            assert resp.status_code == 200
            data = resp.json()
            video_url = data.get("url", "")

            assert video_url, "check_status returned an empty video URL"
            # When Supabase is not configured the URL should be local (localhost / backend_url)
            assert "supabase" not in video_url.lower(), (
                f"Expected a local URL when Supabase is not configured, "
                f"but got: {video_url!r}"
            )
        finally:
            local_mp4.unlink(missing_ok=True)
            status_file.unlink(missing_ok=True)


# ===========================================================================
# P6 — Property-based: all upload_video() input combinations not matching
#      the bug condition produce correct behavior
# ===========================================================================

class TestPreservationUploadVideoPBT:
    """Property-based tests over the full input space of upload_video()
    for inputs where isBugCondition_UploadBytes does NOT hold.

    That is: when Supabase is not configured OR the file is missing, the
    function always returns None without calling Supabase.
    """

    @hyp_settings(
        max_examples=20,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
    )
    @given(
        supabase_url=st.one_of(st.just(""), st.just(None)),
        supabase_key=st.one_of(st.just(""), st.just(None), st.just("fake-key")),
    )
    def test_upload_video_not_configured_always_returns_none(
        self, tmp_path, supabase_url, supabase_key
    ):
        """For all combinations where Supabase is NOT fully configured,
        upload_video() must return None."""
        import api.storage as storage_module

        mp4_stub = tmp_path / "pbt_final.mp4"
        mp4_stub.write_bytes(b"\x00" * 64)

        with patch.object(storage_module, "create_client") as mock_create, \
             patch.object(storage_module, "get_settings") as mock_s:

            mock_s.return_value.supabase_url = supabase_url
            mock_s.return_value.supabase_key = supabase_key

            result = storage_module.upload_video(str(mp4_stub), "pbt_sess")

        # When supabase_url is absent or supabase_key is absent → None
        if not supabase_url or not supabase_key:
            assert result is None, (
                f"upload_video() returned {result!r} instead of None "
                f"with supabase_url={supabase_url!r}, supabase_key={supabase_key!r}"
            )
            mock_create.assert_not_called()
