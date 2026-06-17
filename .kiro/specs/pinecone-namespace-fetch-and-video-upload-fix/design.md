# Pinecone Namespace Fetch and Video Upload Fix — Bugfix Design

## Overview

This document covers two independent bugs in CaptureOS v3 that are bundled into one fix because both affect the post-recording user experience.

**Bug 1 — Namespace fetch (extension/popup.js):** When the Chrome extension popup opens, it attempts to fetch Pinecone namespaces from the backend. In the `carregarModulosPratica` and `carregarRoteiros` code paths a `localhost:8000` fallback is used when `backendUrl` is absent, but the namespace fetch path skips this fallback. Additionally, when the backend is unreachable the `.catch()` handler logs the error to the console instead of swallowing it silently. The result is that the `rag-namespaces-list` datalist is never populated and a `TypeError: Failed to fetch` appears in the console.

**Bug 2 — Supabase video upload (api/storage.py + api/main.py):** Two sub-defects cause black-screen videos and broken URLs:
1. `api/storage.py` passes an open file object to `supabase.storage.from_("videos").upload()`. Some versions of supabase-py expect `bytes`, not a file handle, producing an empty or corrupt upload.
2. `api/main.py`'s `_get_video_url()` only returns the Supabase URL when the local file does **not** exist. Because the local file is never deleted after upload the function always falls back to the local server URL, making the video inaccessible to anyone not on the same machine.

The fix strategy is minimal and targeted:
- Bug 1: add the `localhost:8000` fallback to the namespace fetch block and change `.catch(err => console.error(...))` to a silent no-op.
- Bug 2a: read the file into `bytes` before calling `supabase.storage.upload()`.
- Bug 2b: track the Supabase URL returned by `upload_video()` and pass it into `_get_video_url()` so the local-file existence check is bypassed when a cloud URL is already known.

---

## Glossary

- **Bug_Condition (C)**: The set of runtime states that trigger the defective behavior described in each bug.
- **Property (P)**: The desired correct behavior when the bug condition holds — what the fixed code must produce.
- **Preservation**: Behaviors that must remain identical before and after the fix for all inputs that do NOT satisfy the bug condition.
- **fetchNamespaces / fetchNamespaces'**: The namespace-fetch code block in `popup.js` before / after the fix.
- **upload_video / upload_video'**: The function in `api/storage.py` before / after the fix.
- **_get_video_url / _get_video_url'**: The inner helper in `api/main.py` before / after the fix.
- **PopupStorageState**: The combined state of `chrome.storage.local` values (`backendUrl`, `authToken`) at the time the popup opens.
- **UploadCall**: A call to `upload_video()` including the local file path and session ID.
- **VideoUrlQuery**: The runtime state at the time `_get_video_url()` is evaluated, including whether a Supabase URL was produced by `upload_video()` and whether the local file exists.

---

## Bug Details

### Bug 1 — Namespace Fetch

The bug manifests when the Chrome extension popup opens and attempts to fetch Pinecone namespaces. The fetch block in `popup.js` is missing two things that the other fetch blocks in the same file already have: (a) a `localhost:8000` fallback when `backendUrl` is not set, and (b) a silent `.catch()` that swallows the error gracefully rather than emitting a console error.

**Formal Specification:**

```
FUNCTION isBugCondition_NamespaceFetch(X)
  INPUT: X of type PopupStorageState
  OUTPUT: boolean

  RETURN (X.backendUrl IS NULL OR X.backendUrl = "")
         OR (X.backendUrl IS NOT NULL AND backend_unreachable(X) AND not_silently_caught(X))
END FUNCTION
```

**Examples:**

- User has never configured the backend URL → `backendUrl` is absent → fetch is skipped entirely, no fallback attempted → datalist stays empty. Expected: fallback to `localhost:8000` and attempt fetch.
- User is on a machine where the backend is down → fetch throws `TypeError: Failed to fetch` → console error logged → datalist stays empty. Expected: error swallowed silently, datalist retains the "auto" option.
- User closes the popup before the fetch resolves → in-flight fetch aborts → unhandled rejection surfaces. Expected: abort handled gracefully with no visible side-effect.

---

### Bug 2a — Supabase Upload (file object vs bytes)

The bug manifests when `upload_video()` in `api/storage.py` opens the file and passes the file handle directly to the Supabase client instead of reading the bytes first.

**Formal Specification:**

```
FUNCTION isBugCondition_UploadBytes(X)
  INPUT: X of type UploadCall
  OUTPUT: boolean

  RETURN typeof(X.file_argument_passed_to_supabase) = FileObject
END FUNCTION
```

**Examples:**

- `upload_video("data/videos_gerados/abc_final.mp4", "abc")` called → supabase-py receives a `BufferedReader` → uploads 0 bytes or raises internally → public URL is generated but the bucket object is empty → video plays as black screen.

---

### Bug 2b — Video URL Selection (local file shadows Supabase URL)

The bug manifests when `_get_video_url()` in `api/main.py` is called after a successful Supabase upload while the local file still exists on disk.

**Formal Specification:**

```
FUNCTION isBugCondition_VideoUrl(X)
  INPUT: X of type VideoUrlQuery
  OUTPUT: boolean

  RETURN X.supabase_upload_succeeded = TRUE
         AND os.path.exists(X.local_path) = TRUE
END FUNCTION
```

**Examples:**

- Upload to Supabase returns a public URL → local file `data/videos_gerados/abc_final.mp4` still exists → `_get_video_url()` returns `http://localhost:8000/videos_gerados/abc_final.mp4` → extension opens a URL that is only accessible on the server machine.
- Upload to Supabase returns a public URL → local file does not exist (already deleted manually) → `_get_video_url()` returns the correct Supabase URL. This is the accidental "working" path that the fix makes the default.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- When the backend is reachable and returns namespaces, the datalist is still populated correctly (Bug 1 fix must not break the happy path).
- When the user selects a namespace, it is still saved to `chrome.storage.local` and used at recording stop.
- `carregarModulosPratica` and `carregarRoteiros` are not touched; their fallback and error-handling logic is unchanged.
- When Supabase is not configured (`supabase_url` or `supabase_key` absent), `upload_video()` still returns `None` immediately and `_get_video_url()` still returns the local URL.
- When the local video file does not exist and Supabase is configured, `_get_video_url()` still returns the Supabase public URL (already working path, must stay working).
- When the re-render pipeline completes, it still transitions to status "completed" and generates all artifacts (PDF, transcript, quiz, SCORM).
- When `upload_video()` raises an exception it still catches it, logs it, and returns `None` so the pipeline does not crash.

**Scope:**
All inputs that do NOT trigger any of the three bug conditions above must produce identical output before and after the fix.

---

## Hypothesized Root Cause

### Bug 1 — Namespace Fetch

1. **Missing fallback URL**: The namespace fetch block was added after the other two fetch blocks and the developer forgot to copy the `|| ("http://" + "localhost" + ":8000")` pattern.
2. **Non-silent `.catch()`**: `console.error("Falha ao buscar namespaces:", err)` is a copy from a debug session and was never converted to a silent degradation. The other fetch blocks use a `catch (e) { container.innerHTML = ... }` pattern that surfaces errors in-UI rather than the console, but for a background/optional fetch the right behavior is to swallow the error entirely.
3. **Guard condition missing**: The outer `if (res.backendUrl && res.authToken)` guard only prevents the fetch when both values are absent. When `backendUrl` is absent but `authToken` is present (or vice versa) the guard still fires and `res.backendUrl` is `undefined`, producing a fetch to `undefined/api/v1/rag/namespaces`.

### Bug 2a — Supabase Upload

1. **supabase-py API mismatch**: Older versions of `supabase-py` (< 2.x) accepted file objects; newer versions require `bytes`. The `with open(...) as f: supabase.upload(file=f)` pattern works in one version but silently fails in another. Reading bytes explicitly with `f.read()` is version-agnostic.

### Bug 2b — Video URL Selection

1. **Inverted conditional logic**: `_get_video_url()` was written to use Supabase as a fallback (when the local file is missing) rather than as the primary store. The intent of uploading to Supabase is to make the video accessible externally, but the local-file-exists check defeats this. The fix requires the caller (`check_status` / `get_artifacts`) to know whether a Supabase upload succeeded and to pass that information into `_get_video_url()`.

---

## Correctness Properties

Property 1: Bug Condition — Namespace Fetch Graceful Degradation

_For any_ popup open event where the bug condition holds (backend unreachable, `backendUrl` absent, or fetch aborted), the fixed `fetchNamespaces'` code SHALL leave the `rag-namespaces-list` datalist containing at least the default "auto" option and SHALL NOT log an error to the console or throw an unhandled rejection.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Namespace Fetch Happy Path

_For any_ popup open event where the bug condition does NOT hold (backend reachable and returns namespaces), the fixed `fetchNamespaces'` code SHALL produce exactly the same datalist population result as the original code, preserving the successful namespace discovery behavior.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 3: Bug Condition — Supabase Upload Uses Bytes

_For any_ call to `upload_video'()` where the file exists on disk and Supabase is configured, the fixed function SHALL pass `bytes` (not a file object) to the Supabase client, ensuring the uploaded object is non-empty and the returned public URL points to a valid, playable MP4.

**Validates: Requirements 2.4**

Property 4: Bug Condition — Video URL Prefers Supabase

_For any_ call to `_get_video_url'()` where `upload_video'()` has returned a non-`None` public URL (supabase upload succeeded), the fixed helper SHALL return that Supabase public URL regardless of whether the local file still exists on disk.

**Validates: Requirements 2.5**

Property 5: Preservation — Video URL Falls Back to Local

_For any_ call to `_get_video_url'()` where `upload_video'()` returned `None` (Supabase not configured or upload failed), the fixed helper SHALL return the same local server URL as the original code, preserving the local-fallback behavior.

**Validates: Requirements 2.6, 3.4, 3.5**

---

## Fix Implementation

### Changes Required

#### File: `extension/popup.js`

**Function:** Namespace fetch block inside `chrome.storage.local.get(...)` callback (around line 495–510)

**Specific Changes:**

1. **Add `localhost:8000` fallback**: Mirror the pattern from `carregarModulosPratica` and `carregarRoteiros`:
   ```js
   const backendUrl = res.backendUrl || ("http://" + "localhost" + ":8000");
   ```
   Move the fetch inside a block that always has a valid URL, removing the `if (res.backendUrl && res.authToken)` guard or relaxing it to only require `authToken` (since the URL now has a fallback).

2. **Make `.catch()` silent**: Replace `console.error("Falha ao buscar namespaces:", err)` with an empty no-op:
   ```js
   .catch(() => { /* backend unreachable — datalist keeps default "auto" option */ });
   ```

---

#### File: `api/storage.py`

**Function:** `upload_video()`

**Specific Changes:**

1. **Read file into bytes before upload**: Replace the `with open(...) as f: supabase.upload(file=f)` pattern with:
   ```python
   with open(local_path, 'rb') as f:
       file_bytes = f.read()
   supabase.storage.from_("videos").upload(
       path=file_name,
       file=file_bytes,
       file_options={"content-type": "video/mp4", "x-upsert": "true"}
   )
   ```

2. **Delete local file after successful upload** (optional but recommended): After a confirmed successful upload, remove `local_path` so `_get_video_url()` in `main.py` naturally returns the Supabase URL via the existing condition. This is the simplest fix for Bug 2b if we want to avoid changing `main.py` and `check_status`/`get_artifacts`. The design supports either approach; the task list will canonicalize one.

---

#### File: `api/main.py`

**Function:** `_get_video_url()` (defined twice: inside `check_status` and inside `get_artifacts`)

**Specific Changes (alternative to deleting the local file in storage.py):**

1. **Accept an optional `supabase_url` parameter**: Refactor both `_get_video_url()` definitions to accept an optional `cloud_url: str | None = None` argument. When `cloud_url` is not `None`, return it immediately without checking the local file.

2. **Pass the Supabase URL from `rerender_pipeline.py`**: After `upload_video()` returns a non-`None` URL in the re-render pipeline, store it in the session status (e.g., `update_status(session_id, "completed", ..., cloud_url=public_url)`) or pass it back through the status JSON so `check_status` can read it.

   Simpler alternative: just delete the local file in `storage.py` after upload (see point 2 above), which avoids threading the URL through status.

---

## Testing Strategy

### Validation Approach

Testing follows two phases: first run exploratory tests on the **unfixed** code to confirm the bug condition and understand the root cause, then run fix-checking and preservation tests against the **fixed** code.

---

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each bug on unfixed code. Confirm root cause analysis or update the hypothesis.

**Bug 1 — Test Plan**: Mock `chrome.storage.local` with `backendUrl` absent or set to an unreachable URL and open the popup. Assert that the console produces an error and the datalist is empty after the fetch attempt.

**Test Cases**:
1. **No backendUrl stored**: Open popup with `chrome.storage.local` returning `{}` → the namespace fetch code path with absent `backendUrl` should either skip or error (will fail on unfixed code because the fallback is missing).
2. **Backend unreachable**: Open popup with a `backendUrl` that returns a network error → assert `console.error` is called with "Falha ao buscar namespaces" (will demonstrate the non-silent catch on unfixed code).
3. **Popup closed during fetch**: Simulate fetch abort → assert unhandled rejection surfaces on unfixed code.

**Bug 2a — Test Plan**: Call `upload_video()` with a mock Supabase client that records the type of argument passed. Assert the argument is a file object (not bytes) to confirm the bug.

**Test Case**:
4. **File object passed to upload**: Patch `supabase.storage.from_("videos").upload` to capture its `file` kwarg. Call `upload_video()`. Assert `isinstance(captured_file_arg, io.BufferedReader)` — this will pass on unfixed code, confirming the bug.

**Bug 2b — Test Plan**: Call `_get_video_url()` with Supabase configured and the local file present. Assert it returns the local URL (not the Supabase URL) to confirm the bug.

**Test Case**:
5. **Local file exists, Supabase configured**: Create a dummy local file, configure `supabase_url` and `supabase_key` in settings. Assert `_get_video_url()` returns the local URL — demonstrating it never returns the Supabase URL when the local file exists.

**Expected Counterexamples**:
- Bug 1: datalist is empty or console error appears when backend is unreachable / URL absent.
- Bug 2a: Supabase `upload()` receives a `BufferedReader` instead of `bytes`.
- Bug 2b: `_get_video_url()` returns `http://localhost:8000/...` even though Supabase is configured and a successful upload URL is available.

---

### Fix Checking

**Goal**: Verify that for all inputs where each bug condition holds, the fixed function produces the expected behavior.

**Bug 1 Pseudocode:**
```
FOR ALL X WHERE isBugCondition_NamespaceFetch(X) DO
  result ← fetchNamespaces'(X)
  ASSERT datalist_has_auto_option(result)
  ASSERT no_console_error_emitted(result)
  ASSERT no_unhandled_rejection(result)
END FOR
```

**Bug 2a Pseudocode:**
```
FOR ALL X WHERE isBugCondition_UploadBytes(X) DO
  captured_arg ← spy_on_supabase_upload(upload_video'(X))
  ASSERT isinstance(captured_arg, bytes)
  ASSERT upload_succeeded(X) → public_url_non_null(result)
END FOR
```

**Bug 2b Pseudocode:**
```
FOR ALL X WHERE isBugCondition_VideoUrl(X) DO
  result ← _get_video_url'(X)
  ASSERT result = X.supabase_public_url
END FOR
```

---

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition_NamespaceFetch(X) DO
  ASSERT fetchNamespaces(X) = fetchNamespaces'(X)
END FOR

FOR ALL X WHERE NOT isBugCondition_VideoUrl(X) DO
  ASSERT _get_video_url(X) = _get_video_url'(X)
END FOR
```

**Testing Approach**: Property-based testing is suitable for `_get_video_url()` because the input domain (combinations of `supabase_url`, `supabase_key` presence, local file existence, upload success) is small and enumerable. Generate all combinations and assert preservation.

**Test Cases**:
1. **Namespace fetch — happy path preservation**: Backend reachable → datalist still populated with returned namespaces plus "auto" (same as before fix).
2. **Namespace selection preservation**: Selecting a namespace still triggers `chrome.storage.local.set()` with the correct value.
3. **`upload_video()` — Supabase not configured**: Returns `None` without touching Supabase (same as before fix).
4. **`_get_video_url()` — local file absent, Supabase configured**: Still returns Supabase URL (this path already worked; must remain working).
5. **`_get_video_url()` — upload failed (`None` URL)**: Still returns local URL as fallback.
6. **Pipeline completion**: Re-render pipeline still transitions to "completed" and generates all artifacts.

---

### Unit Tests

- Test `fetchNamespaces'` with absent `backendUrl` — datalist unchanged, no console error.
- Test `fetchNamespaces'` with unreachable backend — silent catch, datalist unchanged.
- Test `upload_video'` — assert bytes (not file object) passed to Supabase client mock.
- Test `upload_video'` — Supabase not configured → returns `None`.
- Test `upload_video'` — Supabase raises exception → returns `None`, logs error.
- Test `_get_video_url'` — upload succeeded, local file exists → returns Supabase URL.
- Test `_get_video_url'` — upload failed (`None`), local file exists → returns local URL.
- Test `_get_video_url'` — upload succeeded, local file missing → returns Supabase URL.

### Property-Based Tests

- Generate random combinations of (`supabase_url` present/absent, `supabase_key` present/absent, local file present/absent, `cloud_url` present/absent) and verify `_get_video_url'` satisfies the correctness properties for every combination.
- Generate random valid namespace lists and verify the datalist always contains the "auto" option plus all returned namespaces after a successful fetch.

### Integration Tests

- Full re-render pipeline with a mock Supabase client: verify video upload uses bytes, public URL is stored, and `check_status` returns the Supabase URL.
- Popup open with a mock backend that returns a namespace list: verify datalist is populated.
- Popup open with a mock backend that returns a network error: verify datalist retains "auto" and no console error.
