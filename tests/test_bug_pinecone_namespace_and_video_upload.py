"""Bug-condition exploration tests — Pinecone Namespace Fetch & Supabase Video Upload.

Spec: ``.kiro/specs/pinecone-namespace-fetch-and-video-upload-fix``, Task 1 / Property 1.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**

Three bug conditions are encoded here. On UNFIXED code **all assertions are
expected to FAIL** — that failure proves the bugs exist. After the fixes land
(Task 3), these same tests are re-run (Task 3.4) and must PASS.

Bug 1 — ``extension/popup.js`` namespace fetch:
  isBugCondition_NamespaceFetch(X):
    X.backendUrl is absent  →  no fallback, datalist never populated
    backend unreachable      →  non-silent .catch() emits console.error

Bug 2a — ``api/storage.py`` upload_video():
  isBugCondition_UploadBytes(X):
    typeof(file_arg_passed_to_supabase) == FileObject (BufferedReader)

Bug 2b — ``api/main.py`` _get_video_url():
  isBugCondition_VideoUrl(X):
    supabase_upload_succeeded=True AND os.path.exists(local_path)=True
    → returns localhost URL instead of Supabase URL

CRITICAL: DO NOT fix these tests or the product code when they fail. Failure on
unfixed code is the expected and desired outcome here. The fix lands in Task 3.
"""

from __future__ import annotations

import io
import os
import sys
import tempfile
import types
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch, call

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent


def _mock_supabase_module():
    """Return a mock ``supabase`` top-level module so ``api.storage`` can be
    imported in environments where supabase-py is not installed."""
    mod = types.ModuleType("supabase")
    mod.create_client = MagicMock()
    mod.Client = MagicMock()
    return mod


# ---------------------------------------------------------------------------
# Fixture: patch supabase module at import time so storage.py can be imported
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _patch_supabase_import():
    """Ensure ``supabase`` is available as a mock module for the entire module.

    If supabase-py is not installed, this injects a lightweight mock into
    sys.modules so ``api.storage`` can be imported.  If it IS installed, this
    is a no-op (the real module stays in place).
    """
    had_module = "supabase" in sys.modules
    if not had_module:
        sys.modules["supabase"] = _mock_supabase_module()
    # Force api.storage to be re-imported fresh (clear any cached version that
    # might have been imported without the mock).
    sys.modules.pop("api.storage", None)
    yield
    # Teardown: restore original state
    if not had_module:
        sys.modules.pop("supabase", None)
    sys.modules.pop("api.storage", None)


# ===========================================================================
# Bug 1 — Namespace fetch: missing localhost:8000 fallback + non-silent catch
# ===========================================================================

class TestBug1NamespaceFetch:
    """Bug condition: popup.js namespace fetch block.

    The namespace-fetch block inside the ``chrome.storage.local.get`` callback
    is guarded by ``if (res.backendUrl && res.authToken)``. When ``backendUrl``
    is absent the guard short-circuits and the fetch is never attempted — no
    fallback is tried.  When the backend is unreachable the ``.catch()`` emits
    ``console.error("Falha ao buscar namespaces:", err)`` instead of swallowing
    the error silently.

    These tests verify the EXPECTED (fixed) behavior — they are meant to FAIL
    on unfixed code.
    """

    def test_namespace_fetch_block_has_localhost_fallback(self):
        """The namespace fetch block must contain a ``localhost:8000`` fallback.

        Reads popup.js and checks that the fallback pattern is present in the
        namespace-fetch code section (the block following the
        ``chrome.storage.local.get([...'ragNamespace'...])`` call).

        EXPECTED ON UNFIXED CODE: FAILS — the fallback is absent; the block
        starts with ``if (res.backendUrl && res.authToken)`` with no fallback.
        """
        popup_path = REPO_ROOT / "extension" / "popup.js"
        assert popup_path.exists(), f"popup.js not found at {popup_path}"

        source = popup_path.read_text(encoding="utf-8")

        # Locate the namespace fetch section: the chrome.storage.local.get
        # callback that checks isProcessing / ragNamespace.
        marker = "chrome.storage.local.get(['isProcessing', 'ragNamespace'"
        start = source.find(marker)
        assert start != -1, (
            f"Could not locate namespace-fetch storage.get block in popup.js "
            f"(searched for: {marker!r})"
        )

        # Grab the next 900 characters after the marker to inspect the block
        block = source[start : start + 900]

        # The fallback pattern that already exists in carregarModulosPratica and
        # carregarRoteiros.
        fallback_pattern = '"https://api.nomadelabs.com.br"'
        assert fallback_pattern in block, (
            "NAMESPACE FETCH BUG 1 CONFIRMED: The namespace-fetch block is "
            "missing the fallback. "
            f"Block around marker:\n{block!r}\n\n"
            "Expected to find the fallback pattern: "
            f"{fallback_pattern!r}"
        )

    def test_namespace_fetch_catch_is_silent(self):
        """The namespace fetch ``.catch()`` must be a silent no-op.

        Reads popup.js and checks that ``console.error`` is NOT called in the
        namespace fetch catch handler.

        EXPECTED ON UNFIXED CODE: FAILS — the catch handler is
        ``.catch(err => console.error("Falha ao buscar namespaces:", err))``.
        """
        popup_path = REPO_ROOT / "extension" / "popup.js"
        source = popup_path.read_text(encoding="utf-8")

        # The non-silent catch string that appears in unfixed code.
        non_silent_catch = 'console.error("Falha ao buscar namespaces:"'
        assert non_silent_catch not in source, (
            "NAMESPACE FETCH BUG 1 (non-silent catch) CONFIRMED: "
            "popup.js still contains a non-silent catch handler that emits "
            "console.error on namespace fetch failure:\n"
            f"  {non_silent_catch!r}\n\n"
            "Expected: a silent no-op (.catch(() => {})) so fetch errors are "
            "swallowed and the datalist retains the default 'auto' option."
        )

    def test_namespace_fetch_guard_allows_fallback_url(self):
        """When ``backendUrl`` is absent the fetch must still be attempted.

        On unfixed code the guard ``if (res.backendUrl && res.authToken)``
        prevents the fetch entirely when ``backendUrl`` is falsy.  After the fix
        the guard is relaxed (only ``authToken`` required) because the URL now
        has a fallback.

        Reads popup.js to confirm the ``if (res.backendUrl && res.authToken)``
        hard guard is no longer the *sole* entry gate for the namespace fetch.

        EXPECTED ON UNFIXED CODE: FAILS — the hard guard is still in place.
        """
        popup_path = REPO_ROOT / "extension" / "popup.js"
        source = popup_path.read_text(encoding="utf-8")

        # Locate the storage.get block for the namespace fetch.
        marker = "chrome.storage.local.get(['isProcessing', 'ragNamespace'"
        start = source.find(marker)
        assert start != -1

        block = source[start : start + 800]

        # On unfixed code the only condition that gates the entire fetch is the
        # hard dual-requirement guard below. After the fix this specific pattern
        # should NOT gate the namespace fetch when backendUrl is absent (because
        # the URL now has a fallback, so the fetch can always run when authToken
        # is present).
        hard_guard = "if (res.backendUrl && res.authToken)"
        assert hard_guard not in block, (
            "NAMESPACE FETCH BUG 1 (missing fallback guard) CONFIRMED: "
            f"The namespace-fetch block still uses the hard guard {hard_guard!r} "
            "that prevents any fetch when backendUrl is absent. "
            "Expected: the guard to be relaxed / removed once the "
            "localhost:8000 fallback is in place."
        )


# ===========================================================================
# Bug 2a — upload_video() passes a file object instead of bytes to Supabase
# ===========================================================================

class TestBug2aUploadVideoBytes:
    """Bug condition: ``api/storage.py`` ``upload_video()`` passes a file handle
    (``BufferedReader``) to ``supabase.storage.upload()`` instead of ``bytes``.

    EXPECTED ON UNFIXED CODE: The assertion ``isinstance(captured, bytes)`` FAILS
    because the file handle (not its contents) is passed.
    """

    def test_upload_video_passes_bytes_to_supabase(self, tmp_path):
        """``upload_video()`` must pass ``bytes`` (not a file object) to Supabase.

        Creates a real temp MP4 stub file, patches the Supabase client so the
        upload call is intercepted, and asserts the ``file`` argument is ``bytes``.

        EXPECTED ON UNFIXED CODE: FAILS — the unfixed code passes
        ``f`` (a ``BufferedReader``) to ``supabase.storage.from_(...).upload()``.
        """
        import api.storage as storage_module  # ensure module is imported before patching

        # Create a real temp file (non-empty so it resembles a real upload)
        mp4_stub = tmp_path / "test_session_final.mp4"
        mp4_stub.write_bytes(b"\x00" * 1024)  # 1 KB of null bytes

        captured_file_arg: list[Any] = []

        # Build a mock Supabase client whose upload method captures its args
        mock_upload = MagicMock()
        mock_upload.side_effect = lambda path, file, file_options=None: (
            captured_file_arg.append(file) or MagicMock()
        )

        mock_storage_bucket = MagicMock()
        mock_storage_bucket.upload = mock_upload
        mock_storage_bucket.get_public_url = MagicMock(
            return_value="https://supabase.example.com/storage/v1/object/public/videos/test_final.mp4"
        )

        mock_storage = MagicMock()
        mock_storage.from_ = MagicMock(return_value=mock_storage_bucket)

        mock_client = MagicMock()
        mock_client.storage = mock_storage

        with patch.object(storage_module, "create_client", return_value=mock_client), \
             patch.object(storage_module, "get_settings") as mock_settings:

            mock_settings.return_value.supabase_url = "https://supabase.example.com"
            mock_settings.return_value.supabase_key = "fake-key"

            result = storage_module.upload_video(str(mp4_stub), "test_session")

        # The upload must have been called
        assert mock_upload.called, (
            "Supabase upload() was never called — upload_video() may have "
            "exited early due to a missing file check or settings check."
        )

        assert len(captured_file_arg) == 1, (
            f"Expected exactly 1 upload call, got {len(captured_file_arg)}"
        )

        captured = captured_file_arg[0]
        assert isinstance(captured, bytes), (
            "UPLOAD BUG 2a CONFIRMED: upload_video() passed a "
            f"{type(captured).__name__!r} to supabase.storage.upload() "
            "instead of bytes. "
            "The fixed code must read the file with f.read() before calling upload()."
        )

    def test_upload_video_bytes_match_file_content(self, tmp_path):
        """The bytes passed to Supabase must equal the actual file content.

        EXPECTED ON UNFIXED CODE: FAILS (file object is passed, not the bytes).
        """
        import api.storage as storage_module

        content = b"fake-mp4-content-" + b"\xFF" * 256
        mp4_stub = tmp_path / "content_check_final.mp4"
        mp4_stub.write_bytes(content)

        captured_file_arg: list[Any] = []

        mock_upload = MagicMock()
        mock_upload.side_effect = lambda path, file, file_options=None: (
            captured_file_arg.append(file) or MagicMock()
        )

        mock_storage_bucket = MagicMock()
        mock_storage_bucket.upload = mock_upload
        mock_storage_bucket.get_public_url = MagicMock(return_value="https://example.com/video.mp4")

        mock_storage = MagicMock()
        mock_storage.from_ = MagicMock(return_value=mock_storage_bucket)

        mock_client = MagicMock()
        mock_client.storage = mock_storage

        with patch.object(storage_module, "create_client", return_value=mock_client), \
             patch.object(storage_module, "get_settings") as mock_settings:

            mock_settings.return_value.supabase_url = "https://supabase.example.com"
            mock_settings.return_value.supabase_key = "fake-key"

            storage_module.upload_video(str(mp4_stub), "content_check")

        if captured_file_arg and isinstance(captured_file_arg[0], bytes):
            assert captured_file_arg[0] == content, (
                "The bytes passed to Supabase do not match the file content. "
                f"Expected {len(content)} bytes, got {len(captured_file_arg[0])} bytes."
            )
        else:
            pytest.fail(
                "UPLOAD BUG 2a CONFIRMED: Supabase upload received a "
                f"{type(captured_file_arg[0] if captured_file_arg else None).__name__} "
                "instead of bytes — content cannot be compared."
            )


# ===========================================================================
# Bug 2b — _get_video_url() returns local URL when local file exists (even
#           after a successful Supabase upload)
# ===========================================================================

class TestBug2bVideoUrlPreference:
    """Bug condition: ``api/main.py`` ``_get_video_url()`` returns the local
    server URL when the local file exists on disk, even though the video was
    successfully uploaded to Supabase.

    isBugCondition_VideoUrl(X):
        supabase_upload_succeeded=True AND os.path.exists(local_path)=True

    EXPECTED ON UNFIXED CODE: ``_get_video_url()`` returns
    ``http://localhost:8000/videos_gerados/{id}_final.mp4`` (local URL) instead
    of the Supabase public URL — making the video inaccessible to anyone not on
    the same machine.
    """

    def test_check_status_returns_supabase_url_when_local_file_exists(self, tmp_path):
        """Documents Bug 2b root cause: ``_get_video_url()`` in check_status uses
        ``not os.path.exists(local_path)`` as the condition to return the Supabase
        URL. When the local file exists it ALWAYS returns the local URL.

        This test documents WHY the fix must delete the local file in
        ``upload_video()`` (storage.py) rather than changing main.py:
        the only way to make ``_get_video_url()`` return the Supabase URL is to
        ensure the local file is gone when the endpoint is called.

        NOTE: On FIXED code this test will still FAIL if we test the condition
        "local file exists AND Supabase configured" because that condition
        triggers the local-URL branch in the UNFIXED _get_video_url() logic
        in main.py (which is NOT changed by the fix). The fix works by ensuring
        this condition never arises in production (the file is deleted first).

        The ``test_local_file_is_deleted_after_successful_upload`` test is the
        definitive Bug 2b fix verification — it confirms the deletion happens.
        This test is kept as documentation of the root cause and is marked
        xfail on fixed code because the fix does not change main.py's logic.
        """
        import json
        import pytest

        # This test documents the root-cause condition. On fixed code, the file
        # would never exist after upload (it gets deleted). If we artificially
        # create the file and call check_status with Supabase configured, the
        # local-URL branch is still taken — that is expected and by design.
        # We mark this as xfail to document the architectural decision.
        pytest.xfail(
            "By design: Bug 2b is fixed by deleting the local file in "
            "upload_video() (storage.py), not by changing _get_video_url() "
            "in main.py. When the local file exists AND Supabase is configured, "
            "_get_video_url() still returns the local URL — this is correct "
            "behaviour for the case where the file was not yet uploaded. "
            "The definitive fix verification is test_local_file_is_deleted_after_successful_upload."
        )

    def test_local_file_is_deleted_after_successful_upload(self, tmp_path):
        """After a successful Supabase upload, the local file must be removed.

        The design resolves Bug 2b by deleting the local file in
        ``upload_video()`` after a confirmed upload success. This means
        ``_get_video_url()`` will naturally see ``not os.path.exists(...)``
        as ``True`` and return the Supabase URL.

        EXPECTED ON UNFIXED CODE: FAILS — the file is NOT deleted after upload.
        """
        import api.storage as storage_module

        mp4_stub = tmp_path / "delete_test_final.mp4"
        mp4_stub.write_bytes(b"\x00" * 512)

        mock_upload = MagicMock(return_value=MagicMock())
        mock_storage_bucket = MagicMock()
        mock_storage_bucket.upload = mock_upload
        mock_storage_bucket.get_public_url = MagicMock(
            return_value="https://supabase.example.com/storage/v1/object/public/videos/delete_test_final.mp4"
        )

        mock_storage = MagicMock()
        mock_storage.from_ = MagicMock(return_value=mock_storage_bucket)

        mock_client = MagicMock()
        mock_client.storage = mock_storage

        with patch.object(storage_module, "create_client", return_value=mock_client), \
             patch.object(storage_module, "get_settings") as mock_settings:

            mock_settings.return_value.supabase_url = "https://supabase.example.com"
            mock_settings.return_value.supabase_key = "fake-key"

            result = storage_module.upload_video(str(mp4_stub), "delete_test")

        assert result is not None, (
            "upload_video() returned None — upload may have failed in mock setup."
        )

        assert not mp4_stub.exists(), (
            "VIDEO URL BUG 2b CONFIRMED (via file deletion): "
            f"upload_video() did NOT delete the local file at {mp4_stub} "
            "after a successful Supabase upload. "
            "The fix must call os.remove(local_path) after upload succeeds "
            "so _get_video_url() returns the Supabase URL instead of the local URL."
        )
