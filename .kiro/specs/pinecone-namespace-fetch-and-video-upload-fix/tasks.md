# Implementation Plan

- [ ] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - Namespace Fetch Missing Fallback & Non-Silent Catch
  - **CRITICAL**: These tests MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior — they will validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate all three bug conditions exist
  - **Scoped PBT Approach**: Scope each property to the concrete failing scenario to ensure reproducibility
  - **Bug 1 — No backendUrl stored**: Mock `chrome.storage.local` returning `{}` (no `backendUrl`). Assert that `fetchNamespaces'` result still contains the "auto" option in the datalist and does NOT log a console error. On unfixed code this fails because there is no `localhost:8000` fallback — the `if (res.backendUrl && res.authToken)` guard skips the fetch entirely without a fallback attempt.
  - **Bug 1 — Backend unreachable**: Mock `backendUrl` set to an unreachable URL so `fetch` throws `TypeError: Failed to fetch`. Assert no `console.error` call and datalist retains "auto". On unfixed code this fails because `.catch(err => console.error(...))` is non-silent.
  - **Bug 2a — File object passed to Supabase upload**: Patch `supabase.storage.from_("videos").upload` to capture its `file` kwarg. Call `upload_video()` with a real temp file. Assert `isinstance(captured_file_arg, bytes)`. On unfixed code this assertion fails because `f` (a `BufferedReader`) is passed instead.
  - **Bug 2b — Local file shadows Supabase URL**: Create a dummy local MP4 at `data/videos_gerados/{session_id}_final.mp4`. Configure `supabase_url` and `supabase_key` in settings. Call `_get_video_url()` (from `check_status` or `get_artifacts` inner function). Assert result equals the Supabase public URL (not `localhost`). On unfixed code this assertion fails because the local file exists and the function returns the local URL.
  - Run all tests on UNFIXED code
  - **EXPECTED OUTCOME**: All assertions FAIL (this is correct — it proves the bugs exist)
  - Document counterexamples found:
    - Bug 1: datalist empty / console error emitted when `backendUrl` absent or backend unreachable
    - Bug 2a: Supabase `upload()` receives a `BufferedReader` instead of `bytes`
    - Bug 2b: `_get_video_url()` returns `http://localhost:8000/...` even though Supabase upload succeeded
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Happy Path and Fallback Behaviors Unchanged
  - **IMPORTANT**: Follow observation-first methodology — run UNFIXED code first and record outputs
  - **Observe on unfixed code:**
    - `carregarModulosPratica` with reachable backend returns populated modules list → observe response structure
    - `carregarRoteiros` with reachable backend returns populated roteiros list → observe response structure
    - `upload_video()` with `supabase_url = ""` returns `None` immediately
    - `upload_video()` when Supabase raises an exception returns `None` and logs the error
    - `_get_video_url()` when local file does NOT exist and Supabase is configured returns the Supabase public URL
    - `_get_video_url()` when `upload_video()` returned `None` (Supabase not configured) returns the local URL
  - **Write property-based tests capturing these observed behaviors:**
    - Property: for all combinations of (supabase_url absent/present, supabase_key absent/present, local file absent) where `¬isBugCondition_VideoUrl(X)` holds, `_get_video_url(X) = _get_video_url'(X)`
    - Property: for all reachable-backend scenarios where `¬isBugCondition_NamespaceFetch(X)` holds, the datalist is populated with the returned namespaces plus "auto"
    - Property: `upload_video()` with Supabase not configured always returns `None` regardless of file content
    - Property: `upload_video()` that raises internally always returns `None` without re-raising (pipeline stability)
  - Verify all preservation tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and confirmed passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 3. Fix: namespace fetch fallback + silent catch, Supabase bytes upload, video URL preference

  - [ ] 3.1 Fix Bug 1 — Add `localhost:8000` fallback and silent catch in `extension/popup.js`
    - Locate the `chrome.storage.local.get(['isProcessing', 'ragNamespace', 'backendUrl', 'authToken'], ...)` callback (~line 490)
    - Extract a `backendUrl` variable with the same fallback pattern used in `carregarModulosPratica` and `carregarRoteiros`:
      ```js
      const backendUrl = res.backendUrl || ("http://" + "localhost" + ":8000");
      ```
    - Remove the `if (res.backendUrl && res.authToken)` guard (or relax it to only require `authToken`, since URL now has a fallback) so the namespace fetch always runs when `authToken` is present
    - Replace `.catch(err => console.error("Falha ao buscar namespaces:", err))` with a silent no-op:
      ```js
      .catch(() => { /* backend unreachable — datalist keeps default "auto" option */ });
      ```
    - _Bug_Condition: isBugCondition_NamespaceFetch(X) — backendUrl absent OR backend unreachable AND non-silent catch_
    - _Expected_Behavior: datalist_contains_auto_option(result) AND no_console_error_emitted(result) AND no_unhandled_rejection(result)_
    - _Preservation: carregarModulosPratica and carregarRoteiros are NOT modified; namespace selection still saves to chrome.storage.local_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

  - [ ] 3.2 Fix Bug 2a — Read file bytes before Supabase upload in `api/storage.py`
    - Locate `upload_video()` in `api/storage.py`
    - Inside the `try` block, replace the `with open(local_path, 'rb') as f: supabase.storage.upload(file=f, ...)` pattern with an explicit bytes read:
      ```python
      with open(local_path, 'rb') as f:
          file_bytes = f.read()
      supabase.storage.from_("videos").upload(
          path=file_name,
          file=file_bytes,
          file_options={"content-type": "video/mp4", "x-upsert": "true"}
      )
      ```
    - After the upload call succeeds, delete the local file so `_get_video_url()` in `main.py` naturally returns the Supabase URL via its existing `not os.path.exists(local_path)` condition (this resolves Bug 2b without changing `main.py`):
      ```python
      os.remove(local_path)
      logger.info(f"Arquivo local removido após upload bem-sucedido: {local_path}")
      ```
    - _Bug_Condition: isBugCondition_UploadBytes(X) — typeof(file_argument_passed_to_supabase) = FileObject_
    - _Expected_Behavior: isinstance(captured_arg, bytes) AND upload_succeeded → public_url_non_null_
    - _Preservation: Supabase not configured → returns None; exception during upload → catches, logs, returns None_
    - _Requirements: 2.4, 3.4, 3.7_

  - [ ] 3.3 Verify Bug 2b is resolved by the local file deletion in 3.2
    - Confirm that `_get_video_url()` in `api/main.py` (`check_status` and `get_artifacts`) now returns the Supabase URL after a successful upload because `os.path.exists(local_path)` will return `False`
    - No code change to `main.py` required when the local file is deleted in `storage.py`
    - If for any reason deleting in `storage.py` is not desired, as an alternative: refactor both `_get_video_url()` definitions in `main.py` to accept an optional `cloud_url: str | None = None` argument and return it immediately when non-`None`
    - _Bug_Condition: isBugCondition_VideoUrl(X) — supabase_upload_succeeded AND os.path.exists(local_path)_
    - _Expected_Behavior: result = X.supabase_public_url regardless of local file presence_
    - _Preservation: upload_video() returned None → _get_video_url() still returns local URL fallback_
    - _Requirements: 2.5, 2.6, 3.5_

  - [ ] 3.4 Verify bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Namespace Fetch Graceful Degradation + Bytes Upload + Supabase URL Preference
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - The tests from task 1 encode the expected behavior
    - When these tests pass, it confirms the expected behavior is satisfied for all three bugs
    - Run all bug condition exploration tests from step 1 against FIXED code
    - **EXPECTED OUTCOME**: All tests PASS (confirms all three bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Happy Path and Fallback Behaviors Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run all preservation property tests from step 2 against FIXED code
    - **EXPECTED OUTCOME**: All tests PASS (confirms no regressions)
    - Confirm: namespace fetch happy path still populates datalist correctly
    - Confirm: `upload_video()` with Supabase not configured still returns `None`
    - Confirm: `_get_video_url()` with no Supabase config still returns local URL
    - Confirm: pipeline still transitions to "completed" with all artifacts generated

- [ ] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite (`pytest` for Python, and the popup JS tests)
  - Confirm Property 1 (Bug Condition) tests pass — bugs are fixed
  - Confirm Property 2 (Preservation) tests pass — no regressions
  - Verify end-to-end: re-render pipeline completes, video is accessible via Supabase URL
  - Ask the user if any questions arise before marking complete
