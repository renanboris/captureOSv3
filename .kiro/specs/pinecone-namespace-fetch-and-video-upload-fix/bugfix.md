# Bugfix Requirements Document

## Introduction

This document covers two related bugs in CaptureOS v3:

**Bug 1 — Pinecone namespace fetch failure in the Chrome extension popup.**
When the popup opens and `backendUrl` and `authToken` are present in `chrome.storage.local`, it attempts to fetch Pinecone namespaces from the backend. The fetch fails with `TypeError: Failed to fetch` (popup.js line 507) because the backend may be unreachable (CORS, server down, popup closed before response, or network error). The error is only logged to the console, but the root issue is that the fetch is made without a fallback `backendUrl` in this code path — unlike the `carregarModulosPratica` and `carregarRoteiros` functions which default to `localhost:8000`. This causes a silent degradation where the `rag-namespaces-list` datalist is never populated.

**Bug 2 — Video upload to Supabase produces a black/corrupt video and the wrong URL is returned.**
After the re-render pipeline completes and uploads the video to Supabase Storage, two defects exist:
1. `api/storage.py` passes an open file object to `supabase.storage.from_("videos").upload()`, but some versions of supabase-py expect `bytes`, not a file object. This results in an empty or corrupt upload (black screen when played).
2. `api/main.py`'s `_get_video_url()` only returns the Supabase URL when the local file does **not** exist. Because the local file is never deleted after upload, `_get_video_url()` always returns the local server URL — which may be inaccessible from outside the server — instead of the public Supabase URL.

---

## Bug Analysis

### Current Behavior (Defect)

**Bug 1 — Namespace fetch:**

1.1 WHEN the popup opens AND `backendUrl` is stored in `chrome.storage.local` AND the backend is unreachable (server down, CORS blocked, or network error) THEN the system raises `TypeError: Failed to fetch` and logs "Falha ao buscar namespaces: TypeError: Failed to fetch" to the console without populating the namespace datalist

1.2 WHEN the popup opens AND `backendUrl` is stored in `chrome.storage.local` AND the popup is closed by the user before the fetch resolves THEN the system raises a network error (port closed / popup unloaded) for the in-flight fetch

1.3 WHEN the popup opens AND `backendUrl` is NOT set in `chrome.storage.local` THEN the system skips the namespace fetch entirely, leaving the datalist with only the static "auto" option — with no fallback to `localhost:8000`, unlike the other fetch calls in the same file

**Bug 2 — Supabase video upload:**

1.4 WHEN `upload_video()` is called in `api/storage.py` THEN the system passes an open file object to `supabase.storage.from_("videos").upload()`, which causes some versions of supabase-py to upload empty or corrupt content, resulting in a black-screen video in Supabase Storage

1.5 WHEN `_get_video_url()` is called in `api/main.py` after a successful Supabase upload AND the local file `data/videos_gerados/{session_id}_final.mp4` still exists on disk THEN the system returns the local server URL instead of the public Supabase URL, making the video inaccessible from outside the server

1.6 WHEN `_get_video_url()` is called in `api/main.py` after a successful Supabase upload AND the local file has not been deleted THEN the system always returns the local URL regardless of whether Supabase is configured, defeating the purpose of cloud storage

---

### Expected Behavior (Correct)

**Bug 1 — Namespace fetch:**

2.1 WHEN the popup opens AND `backendUrl` is stored in `chrome.storage.local` AND the backend is unreachable THEN the system SHALL silently ignore the error and leave the datalist with the default "auto" option, without logging a user-visible error

2.2 WHEN the popup opens AND the popup is closed before the namespace fetch resolves THEN the system SHALL handle the resulting network error gracefully without propagating an unhandled rejection

2.3 WHEN the popup opens AND `backendUrl` is NOT set in `chrome.storage.local` THEN the system SHALL use the same `localhost:8000` fallback used by `carregarModulosPratica` and `carregarRoteiros` when attempting the namespace fetch, so that local development works without explicit configuration

**Bug 2 — Supabase video upload:**

2.4 WHEN `upload_video()` is called in `api/storage.py` THEN the system SHALL read the file contents into `bytes` before passing them to `supabase.storage.from_("videos").upload()`, ensuring the upload produces a valid, playable MP4 file

2.5 WHEN `upload_video()` returns a non-`None` public URL (indicating a successful Supabase upload) THEN `_get_video_url()` in `api/main.py` SHALL return that public Supabase URL regardless of whether the local file still exists on disk

2.6 WHEN `upload_video()` returns `None` (Supabase not configured or upload failed) THEN `_get_video_url()` in `api/main.py` SHALL CONTINUE TO return the local server URL as a fallback

---

### Unchanged Behavior (Regression Prevention)

**Bug 1 — Namespace fetch:**

3.1 WHEN the popup opens AND the backend is reachable AND namespaces are returned THEN the system SHALL CONTINUE TO populate the `rag-namespaces-list` datalist with the returned namespaces plus the default "auto" option

3.2 WHEN the user selects a namespace from the datalist THEN the system SHALL CONTINUE TO save the selected value to `chrome.storage.local` and use it when recording stops

3.3 WHEN `carregarModulosPratica` or `carregarRoteiros` are called THEN the system SHALL CONTINUE TO use their existing `localhost:8000` fallback logic and error handling, unchanged

**Bug 2 — Supabase video upload:**

3.4 WHEN Supabase is not configured (no `supabase_url` or `supabase_key` in settings) THEN the system SHALL CONTINUE TO skip the upload and return `None` from `upload_video()`, serving the video locally

3.5 WHEN the local video file does not exist AND Supabase is configured THEN the system SHALL CONTINUE TO return the Supabase public URL from `_get_video_url()`

3.6 WHEN the re-render pipeline completes successfully THEN the system SHALL CONTINUE TO update the session status to "completed" and generate all artifacts (PDF, transcript, quiz, SCORM) as before

3.7 WHEN the re-render pipeline calls `upload_video()` and it raises an exception THEN the system SHALL CONTINUE TO catch it, log the error, and return `None` so the video falls back to local serving without crashing the pipeline

---

## Bug Condition Pseudocode

### Bug 1 — Namespace Fetch

```pascal
FUNCTION isBugCondition_NamespaceFetch(X)
  INPUT: X of type PopupStorageState
  OUTPUT: boolean

  // Bug fires when the namespace fetch path lacks a fallback URL and/or
  // silently fails without graceful degradation
  RETURN (X.backendUrl IS NULL OR X.backendUrl = "") AND namespace_fetch_attempted(X)
         OR (X.backendUrl IS NOT NULL AND backend_unreachable(X) AND no_silent_catch(X))
END FUNCTION

// Property: Fix Checking — graceful degradation
FOR ALL X WHERE isBugCondition_NamespaceFetch(X) DO
  result ← fetchNamespaces'(X)
  ASSERT datalist_contains_auto_option(result) AND no_console_error_shown_to_user(result)
END FOR

// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition_NamespaceFetch(X) DO
  ASSERT fetchNamespaces(X) = fetchNamespaces'(X)
END FOR
```

### Bug 2 — Supabase Upload (file object vs bytes)

```pascal
FUNCTION isBugCondition_UploadBytes(X)
  INPUT: X of type UploadCall
  OUTPUT: boolean

  // Bug fires when file is passed as an open file object rather than bytes
  RETURN typeof(X.file_argument) = FileObject
END FUNCTION

// Property: Fix Checking — bytes upload produces valid video
FOR ALL X WHERE isBugCondition_UploadBytes(X) DO
  result ← upload_video'(X)
  ASSERT result IS NOT NULL AND video_is_playable(result)
END FOR
```

### Bug 2 — Video URL Selection (local file shadows Supabase URL)

```pascal
FUNCTION isBugCondition_VideoUrl(X)
  INPUT: X of type VideoUrlQuery
  OUTPUT: boolean

  // Bug fires when Supabase upload succeeded but local file still exists
  RETURN X.supabase_upload_succeeded AND os.path.exists(X.local_path)
END FUNCTION

// Property: Fix Checking — Supabase URL returned when upload succeeded
FOR ALL X WHERE isBugCondition_VideoUrl(X) DO
  result ← _get_video_url'(X)
  ASSERT result = X.supabase_public_url
END FOR

// Property: Preservation Checking — local URL returned when Supabase not used
FOR ALL X WHERE NOT isBugCondition_VideoUrl(X) DO
  ASSERT _get_video_url(X) = _get_video_url'(X)
END FOR
```
