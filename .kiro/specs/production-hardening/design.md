# Production Hardening Bugfix Design

## Overview

CaptureOS v3 is being prepared for its first production deployment. A source-level audit confirmed a family of defects that put the system in a **production-unsafe** state (it can be abused or will fail under real-world load) and/or a **repo-unrunnable** state (a clean checkout cannot be installed, discovered, or probed reliably). This design treats that family as a single bug whose condition `C(X)` is the disjunction of all the confirmed unsafe/unrunnable states, and whose fix `F'` drives the system into a state where `C(X)` is false for every input while preserving every legitimate flow.

The work is organized into two phases that share one bug condition:

- **Phase 0 — Technical-debt cleanup:** remove dead/legacy code (`legacy_agents/`, `legacy_repos_tmp/`), leaked data (`session178_steps.json`), and orphaned files (`test_timebender.py` at root); add `.env.example`; harden `.gitignore`; make `requirements.txt` installable; add `/api/v1/health`.
- **Phase 1 — Minimum production security:** lock down CORS, require authentication on all data routes, make the extension backend endpoint configurable, replace base64-in-JSON video upload with binary/pre-signed upload, move extension event storage to IndexedDB, upgrade the `google-genai` SDK, remove blocking module I/O and add pagination, and disable the undocumented Modo C path.

The fix strategy is deliberately **minimal and targeted**: each sub-condition of `C(X)` maps to a specific, localized change, and every legitimate capture → pipeline → export flow (clauses 3.1–3.8) must remain behaviorally identical for inputs where `C(X)` is false. Cloud sharing/storage before authentication exists is explicitly out of scope.

## Glossary

- **Bug_Condition (C)**: The predicate that is true for any system input/state that is production-unsafe or repo-unrunnable. `C(X)` is the disjunction of the sub-conditions `C1..C15` enumerated in Bug Details, each corresponding to a Current Behavior clause (1.1–1.15).
- **Property (P)**: The desired behavior of the fixed system `F'` for inputs/states where `C(X)` holds — defined per facet in the Correctness Properties section and grounded in Expected Behavior clauses 2.1–2.15.
- **Preservation**: The requirement that for every input where `C(X)` is false, `F'` produces the same observable result as the original `F` — grounded in Unchanged Behavior clauses 3.1–3.8.
- **F / F'**: The system before the fix (`F`) and after the fix (`F'`).
- **Data route**: Any API route that mutates state or returns session/module data (`POST /api/v1/capture/ingest`, `GET|POST /api/v1/session/{id}/roteiro`, `POST /api/v1/session/{id}/passo/{n}/regerar`, `POST /api/v1/tts/preview`, `GET /api/v1/session/{id}/artifacts`, the simlink routes, the sandbox routes). Defined in `api/main.py`.
- **Static mount**: A `StaticFiles` mount in `api/main.py` (`/videos_gerados`, `/editor`, `/artifacts`, `/screenshots`, `/simlink`, `/scorm`, `/audios`, `/scorm-player`).
- **EventPayload**: The Pydantic ingest model in `api/main.py` carrying `video_webm` (currently a base64 string).
- **Modo A / B / C**: Capture narration modes handled in `api/export_pipeline.py` — A = auto narration, B = instructor microphone, C = `roteiro_manual` (undocumented, no UI, no tests).
- **renderizar_exportacao / rerenderizar_com_roteiro_aprovado**: The decoupled export pipeline (`api/export_pipeline.py`) and the post-approval re-render pipeline (`api/rerender_pipeline.py`).
- **BACKEND_URL**: The endpoint constant hardcoded to `http://localhost:8000` in `extension/background.js`.

## Bug Details

### Bug Condition

The bug manifests whenever the system is placed in any production-unsafe or repo-unrunnable state. The defect is not a single line; it is a family of states. The API is configured to trust any origin with credentials, accepts data-route requests without authentication, ships a hardcoded localhost endpoint, transports video as base64-in-JSON, persists capture events in a quota-limited store, pins an obsolete AI SDK, omits runtime dependencies from `requirements.txt`, performs blocking file scans on the async event loop, retains dead code and leaked data in the repo, lacks a health probe, and exposes an undocumented Modo C path.

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT:  X — a request, repository state, or build/runtime configuration
  OUTPUT: boolean   // true means X is in a production-unsafe / repo-unrunnable state

  RETURN
    // --- Phase 1: production security ---
    C1(X):  X is a cross-origin request AND CORS allows "*" together with allow_credentials=true
    OR C2(X):  X targets a data route AND X carries no valid authentication AND the request is processed
    OR C3(X):  X is a request from the published extension AND the backend endpoint equals hardcoded "http://localhost:8000"
    OR C4(X):  X finalizes a recording AND the video is sent as base64-in-JSON inside a single ingest POST
    OR C5(X):  X is a capture interaction AND events/screenshots are persisted to chrome.storage.local (5 MB quota)
    OR C6(X):  X runs the AI pipeline AND the resolved google-genai SDK is the obsolete 0.3.0 pin
    OR C8(X):  X calls GET /api/v1/modulos or POST /api/v1/simlink/{id}/conclusao AND a synchronous glob scan runs on the event loop (no pagination)
    OR C15(X): X is a capture with modo_input == "C" AND the undocumented/untested Modo C path executes

    // --- Phase 0: repo runnability / hygiene ---
    OR C7(X):  X is `pip install -r requirements.txt` on a clean checkout AND an imported dependency is missing (pydantic-settings, static-ffmpeg)
    OR C9(X):  X is a repo checkout AND legacy_agents/ is present
    OR C10(X): X is a repo checkout AND legacy_repos_tmp/ is present
    OR C11(X): X is a repo checkout AND real session data (e.g. session178_steps.json) is present at the repo root
    OR C12(X): X is test discovery AND test_timebender.py is located at the repo root instead of tests/
    OR C13(X): X is project setup AND no .env.example exists OR .gitignore fails to exclude session-data patterns
    OR C14(X): X is a deploy/LB probe AND no /api/v1/health endpoint exists
END FUNCTION
```

### Examples

- **C1 (CORS):** A malicious site at `https://evil.example` issues `fetch('<backend>/api/v1/modulos', {credentials:'include'})`. Expected: rejected by CORS (origin not allowed). Actual: allowed because `allow_origins=["*"]` + `allow_credentials=True` in `api/main.py`.
- **C2 (auth):** `POST /api/v1/capture/ingest` from an anonymous caller. Expected: `401 Unauthorized`. Actual: accepted; `renderizar_exportacao` is triggered, consuming GPU/AI. Likewise `POST /api/v1/session/{id}/roteiro` with `aprovado=true` triggers re-rendering for any anonymous caller.
- **C3 (endpoint):** Published extension on a user's laptop calls `http://localhost:8000/api/v1/capture/ingest`. Expected: calls the deployed backend host. Actual: targets the user's own machine because `const BACKEND_URL = "http://localhost:8000"` in `background.js`.
- **C4 (upload):** A 10-minute WebM (~400–800 MB) is base64-encoded into `payload.video_webm` and POSTed as one JSON body (`finalizeUpload()`). Expected: binary/pre-signed upload completes. Actual: network timeout / Service Worker memory exhaustion.
- **C5 (storage):** ~50 interactions × ~200 KB PNG appended to `eventsLog` in `chrome.storage.local`. Expected: all events retained. Actual: silently exceeds ~5 MB quota; events lost without notice.
- **C7 (deps):** `pip install -r requirements.txt` then `uvicorn api.main:app`. Expected: server starts. Actual: `ModuleNotFoundError: pydantic_settings` (imported by `config/settings.py`); `static_ffmpeg` (imported by `video_eng/time_bender.py`) also missing.
- **C8 (event loop):** `GET /api/v1/modulos` runs `glob.glob("data/simlink/*.json")` synchronously inside an async route and reads every file on every call, with no pagination — O(n) blocking I/O.
- **C9–C12 (hygiene):** `legacy_agents/`, `legacy_repos_tmp/`, `session178_steps.json`, and `test_timebender.py` are all present at the repo root (confirmed by directory listing).
- **C14 (health):** `GET /api/v1/health` returns 404 — no readiness/liveness probe exists.
- **C15 (Modo C):** `EventPayload(modo_input="C", roteiro_manual=[...])` causes `export_pipeline.py` to bypass vision/enrichment and use the manual script directly — a path with no UI, docs, or tests.
- **Edge — ¬C (preservation):** An authenticated, correctly configured client submits a valid ~2-minute recording to `POST /api/v1/capture/ingest`. `C(X)` is false; the capture → export pipeline must run exactly as before.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors** (must continue to work identically after the fix, grounded in clauses 3.1–3.8):

- Authenticated, correctly configured, normally-sized ingest still triggers `renderizar_exportacao` and the decoupled pipeline (3.1).
- The capture → AI → video pipeline still produces the final video at the existing `videos_gerados` URL (3.2).
- Saving a script with `aprovado=true` still persists it and triggers `rerenderizar_com_roteiro_aprovado` (3.3).
- Modo A (auto narration) and Modo B (instructor microphone) still process narration/audio exactly as before (3.4).
- Simlink routes (`GET /api/v1/modulos`, `GET /api/v1/simlink/{id}`, `POST /api/v1/simlink/{id}/conclusao`) still return correct module data, record completions, and fire LMS callbacks (3.5).
- TTS preview, artifact retrieval, script regeneration, and sandbox evaluate/reset routes still return the same results (3.6).
- Static assets still serve from their existing mount points (3.7).
- The relocated `test_timebender.py` is still discovered and still passes (3.8).

**Scope:**
All inputs where `C(X)` is false must be completely unaffected by this fix. Specifically:
- Requests from allowed origins (extension origin, deployed backend host) with valid authentication.
- Normally-sized recordings whose upload mechanism is otherwise unchanged in result (same persisted artifacts, same pipeline trigger).
- Module lookups/listings whose returned data is identical, only the I/O mechanism and pagination behavior change.
- Modo A and Modo B capture flows (only Modo C is disabled).

> Note: The concrete correct behavior for buggy inputs (the `P(result)` side) is defined in the Correctness Properties section. This section enumerates what must NOT change.

## Hypothesized Root Cause

Based on the audit and source inspection, the defects cluster into these root causes:

1. **Insecure-by-default middleware configuration**: `CORSMiddleware` was wired with `allow_origins=["*"]` + `allow_credentials=True` for local development convenience and never tightened for production (`api/main.py`).

2. **Absent authentication layer**: Routes were authored before the auth story existed; `supabase_url` / `supabase_anon_key` / `jwt_secret` settings exist in `config/settings.py` but no dependency enforces them. The only auth-like code is the legacy Playwright auto-login in `capture/auth.py`, which is browser-automation, not API auth, and is slated for removal with the legacy code.

3. **Dev-time shortcuts shipped to production**: A hardcoded `BACKEND_URL` and a base64-in-JSON upload (`extension/background.js`) plus `chrome.storage.local` event persistence were expedient locally but break on real deployments/long recordings.

4. **Dependency drift and omission**: `requirements.txt` pins an obsolete `google-genai==0.3.0` and omits `pydantic-settings` and `static-ffmpeg`, which are imported at runtime — so the manifest does not match the actual import graph.

5. **Blocking I/O in async handlers**: `glob.glob(...)` + per-file `open()` run synchronously inside `async def` routes (`/api/v1/modulos`, `/api/v1/simlink/{id}/conclusao`, `/api/v1/simlink/{id}`), blocking the event loop with no pagination.

6. **Repository hygiene debt**: Legacy/migration directories, leaked session data, and a misplaced test file remain at the repo root; `.gitignore` does not exclude session-data patterns and there is no `.env.example`; there is no health endpoint.

7. **Unfinished/experimental feature left enabled**: Modo C (`roteiro_manual`) is reachable via `EventPayload.modo_input` but has no UI, docs, or tests.

## Correctness Properties

These numbered properties are the single source of truth for validation. Properties 1, 3, 5, 7, 9, 11 define the corrected behavior for inputs where the relevant sub-condition of `C(X)` holds (fix checking). Properties 2, 4, 6 define preservation for inputs where `C(X)` is false (preservation checking).

Property 1: Bug Condition — CORS and authentication lockdown

_For any_ request where the bug condition holds because it is cross-origin from a non-allowed origin (C1) or targets a data route without valid authentication (C2), the fixed system SHALL reject it — rejecting disallowed origins at the CORS layer and returning `401 Unauthorized` for unauthenticated data-route requests — and SHALL never combine a wildcard origin with credentialed access.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation — Authorized data-route behavior

_For any_ request where the bug condition does NOT hold because it originates from an allowed origin and carries valid authentication, the fixed system SHALL produce the same result as the original system for that route (same status code, same response body, same side effects), preserving every legitimate capture, script, simlink, sandbox, and artifact flow.

**Validates: Requirements 3.1, 3.3, 3.5, 3.6**

Property 3: Bug Condition — Extension endpoint and transport correctness

_For any_ extension request where the bug condition holds because the endpoint is the hardcoded localhost value (C3), the video is uploaded as base64-in-JSON (C4), or capture events are persisted to `chrome.storage.local` (C5), the fixed extension SHALL resolve the backend endpoint from configurable `chrome.storage`, upload the video as binary (`multipart/form-data` or pre-signed S3/R2), and persist events/screenshots in IndexedDB so no event is lost to a storage quota.

**Validates: Requirements 2.3, 2.4, 2.5**

Property 4: Preservation — Capture-to-pipeline result equivalence

_For any_ normally-sized, authenticated capture where the bug condition does NOT hold, the fixed upload path SHALL deliver to the backend a payload semantically equivalent to the original (same session_id, events, video bytes, audio, and `modo_input` for Modo A/B), so that `renderizar_exportacao` and the downstream final video at `videos_gerados` are produced exactly as before.

**Validates: Requirements 3.1, 3.2, 3.4**

Property 5: Bug Condition — Non-blocking module I/O with pagination

_For any_ call to `GET /api/v1/modulos` or `POST /api/v1/simlink/{id}/conclusao` where the bug condition holds because a synchronous scan runs on the event loop (C8), the fixed handler SHALL perform module lookup via offloaded/async I/O that does not block the event loop and SHALL support pagination for listing, while returning the same module data for any given filter/page.

**Validates: Requirements 2.8**

Property 6: Preservation — Module data and completion equivalence

_For any_ simlink request where the bug condition does NOT hold, the fixed handlers SHALL return module data, record completions, and fire LMS callbacks identical to the original implementation (the full unpaginated result equals the concatenation of pages in order).

**Validates: Requirements 3.5**

Property 7: Bug Condition — AI SDK currency

_For any_ AI-pipeline invocation where the bug condition holds because the obsolete `google-genai==0.3.0` SDK is resolved (C6), the fixed system SHALL depend on a supported current `google-genai` version with the referenced Gemini model usage verified to work against that version.

**Validates: Requirements 2.6**

Property 8: Bug Condition — Clean install completeness

_For any_ clean `pip install -r requirements.txt` where the bug condition holds because an imported runtime dependency is missing (C7), the fixed `requirements.txt` SHALL list every actually-imported runtime dependency (including `pydantic-settings` and `static-ffmpeg`) so import of `api.main` and `video_eng.time_bender` succeeds.

**Validates: Requirements 2.7**

Property 9: Bug Condition — Repository hygiene

_For any_ repository checkout where the bug condition holds because dead code, leaked data, or misplaced files are present (C9–C13), the fixed repository SHALL NOT contain `legacy_agents/`, `legacy_repos_tmp/`, or root-level real session data; SHALL contain `test_timebender.py` under `tests/`; SHALL provide a `.env.example`; and SHALL have a `.gitignore` that excludes session-data patterns (`data/`, `*.json`, `session_*`, `legacy_repos_tmp/`).

**Validates: Requirements 2.9, 2.10, 2.11, 2.12, 2.13**

Property 10: Bug Condition — Health probe availability

_For any_ deploy/load-balancer probe where the bug condition holds because no health endpoint exists (C14), the fixed system SHALL expose `GET /api/v1/health` returning a successful health status for readiness/liveness checks.

**Validates: Requirements 2.14**

Property 11: Bug Condition — Modo C disabled

_For any_ capture submitted with `modo_input == "C"` where the bug condition holds (C15), the fixed system SHALL reject or disable the Modo C path (e.g. `422`/`400` or explicit "unsupported") until a documented, UI-supported, tested use case exists, while leaving Modo A and Modo B unaffected.

**Validates: Requirements 2.15**

Property 12: Preservation — Static asset serving and test discovery

_For any_ static-asset request or test-discovery run where the bug condition does NOT hold, the fixed system SHALL continue to serve assets from their existing mount points and SHALL continue to discover and pass the relocated time-bender tests.

**Validates: Requirements 3.7, 3.8**

## Fix Implementation

### Changes Required

Assuming the root-cause analysis is correct, the changes are grouped by facet. Each is minimal and localized.

**1. CORS lockdown** — `api/main.py`
- Replace `allow_origins=["*"]` with an explicit allow-list sourced from settings (extension origin `chrome-extension://<ID>` and the deployed backend host).
- Keep `allow_credentials=True` only with the explicit list; never pair it with `"*"`.
- Add an `allowed_origins` (and extension ID) field to `config/settings.py`.

**2. Authentication on data routes** — new `api/auth.py` (or `api/dependencies.py`) + `api/main.py`
- Implement a FastAPI dependency that validates a bearer JWT against `supabase_url` / `supabase_anon_key` / `jwt_secret` (already in `config/settings.py`).
- Apply the dependency to every data route (ingest, script read/write, regerar, tts preview, artifacts, simlink, sandbox). Return `401` on missing/invalid credentials.
- Do NOT repurpose `capture/auth.py`; it is removed with the legacy code (see change 9).

**3. Configurable extension endpoint** — `extension/background.js` (+ options/settings page)
- Remove the hardcoded `const BACKEND_URL = "http://localhost:8000"`.
- Resolve the endpoint at runtime from `chrome.storage` (populated by an options page); fall back to a documented default only in dev.
- Attach the auth token (from change 2) to outgoing requests.

**4. Binary / pre-signed video upload** — `extension/background.js`, `api/main.py`, `api/export_pipeline.py`, `EventPayload`
- Replace base64-in-JSON `finalizeUpload()` with `multipart/form-data` (or pre-signed S3/R2 PUT then notify backend).
- Change the ingest route to accept an uploaded file (e.g. `UploadFile`) instead of `video_webm: str`; adapt `EventPayload` accordingly.
- Update `renderizar_exportacao` to read raw bytes from the uploaded file/stored object instead of `base64.b64decode(payload["video_webm"])`.

**5. IndexedDB event storage** — extension (`background.js` / offscreen / a storage helper module)
- Persist `eventsLog` entries (timestamp, type, eventData, screenshotData) in IndexedDB instead of `chrome.storage.local`.
- On finalize, read events back from IndexedDB; surface an error to the user if persistence fails (no silent loss).

**6. google-genai SDK upgrade** — `requirements.txt` + `api/intelligence_engine.py` (and any other genai call sites)
- Bump `google-genai` to a supported current 1.x version.
- Adapt the Gemini 2.5 Flash call sites to the new API surface; verify against the upgraded SDK.

**7. requirements.txt completeness** — `requirements.txt`
- Add `pydantic-settings` (imported by `config/settings.py`) and `static-ffmpeg` (imported by `video_eng/time_bender.py`), plus any other actually-imported-but-unlisted runtime deps discovered while validating a clean install.

**8. Non-blocking module I/O + pagination** — `api/main.py`
- Offload the `glob` + file reads in `listar_modulos`, `get_simlink_modulo`, and `registrar_conclusao_simlink` using `asyncio.to_thread` (or an async file API) so the event loop is not blocked.
- Add `limit`/`offset` (or page/page_size) parameters to `GET /api/v1/modulos`, returning the same ordering with pagination metadata.

**9. Remove legacy_agents/** — repo
- Move `legacy_agents/` (and `capture/auth.py` if it is part of the dead browser-automation set) to an archive branch, then delete from `main`.

**10. Remove legacy_repos_tmp/** — repo + `.gitignore`
- Delete `legacy_repos_tmp/`; it is already in `.gitignore` (keep it ignored).

**11. Remove leaked session data** — repo + `.gitignore`
- Delete `session178_steps.json` from the repo root; ensure session-data patterns are gitignored.

**12. Relocate test_timebender.py** — repo
- Move `test_timebender.py` from the root into `tests/`, fixing imports/paths as needed.

**13. .env.example + .gitignore hardening** — repo
- Add `.env.example` documenting every required setting (API, storage, IA keys, redis, supabase/jwt, allowed origins).
- Extend `.gitignore` to exclude `*.json`, `session_*` (in addition to existing `data/`, `legacy_repos_tmp/`, `.env`), being careful not to ignore config JSON that must be tracked (scope the pattern, e.g. root-level `session*_steps.json`).

**14. /api/v1/health endpoint** — `api/main.py`
- Add `GET /api/v1/health` returning `{"status": "ok"}` (200), unauthenticated, for readiness/liveness.

**15. Disable Modo C** — `api/main.py` and/or `api/export_pipeline.py`
- Reject `modo_input == "C"` at the ingest boundary (`422`/`400` with a clear message) or short-circuit the Modo C branch in `export_pipeline.py`, leaving Modo A/B paths untouched.

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate each facet of the bug on the UNFIXED code (exploratory bug-condition checking), then verify the fix works for buggy inputs (fix checking) and preserves behavior for non-buggy inputs (preservation checking). Property-based testing is used for the facets with large input domains (auth, pagination, upload equivalence, Modo A/B preservation).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix, and confirm or refute the root-cause analysis. If refuted, re-hypothesize.

**Test Plan**: Drive each sub-condition against the unfixed code and assert the unsafe/unrunnable outcome is observable.

**Test Cases**:
1. **CORS+credentials (C1)**: Send a cross-origin credentialed request from a disallowed origin and observe it is accepted (will fail-to-reject on unfixed code).
2. **Unauthenticated data route (C2)**: `POST /api/v1/capture/ingest` and `POST /api/v1/session/{id}/roteiro?aprovado=true` with no auth; observe `200` + pipeline trigger (should be `401`).
3. **Hardcoded endpoint (C3)**: Assert `background.js` resolves `http://localhost:8000` with no configuration override.
4. **Base64 upload (C4)**: Build a large base64 `video_webm` and observe payload size / failure characteristics on ingest.
5. **chrome.storage.local quota (C5)**: Simulate ~50×200 KB events and observe quota overflow / lost events.
6. **Clean install (C7)**: In a fresh venv, `pip install -r requirements.txt` then `import api.main` / `import video_eng.time_bender`; observe `ModuleNotFoundError` for `pydantic_settings` / `static_ffmpeg`.
7. **Blocking glob (C8)**: Call `GET /api/v1/modulos` with many module files and observe synchronous scan / no pagination.
8. **Hygiene (C9–C13)**: Assert presence of `legacy_agents/`, `legacy_repos_tmp/`, `session178_steps.json`, root `test_timebender.py`, absence of `.env.example`, and `.gitignore` not excluding session-data patterns.
9. **Health (C14)**: `GET /api/v1/health` returns 404.
10. **Modo C (C15)**: Ingest with `modo_input="C"` executes the manual path.

**Expected Counterexamples**:
- Credentialed cross-origin request accepted; unauthenticated mutations succeed; localhost endpoint resolved; oversized payload; lost events; failed import; blocking scan; missing files/endpoint; Modo C executes.
- Possible causes: insecure middleware config, missing auth dependency, dev shortcuts shipped, manifest/import drift, sync I/O in async routes, unfinished feature enabled.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed system produces the expected behavior (Properties 1, 3, 5, 7, 8, 9, 10, 11).

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  result := F_prime(X)
  ASSERT expectedBehavior(result)   // 401/CORS-reject, binary upload, IndexedDB persisted,
                                     // non-blocking+paginated, current SDK, clean install,
                                     // clean repo, health 200, Modo C rejected
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed system produces the same result as the original (Properties 2, 4, 6, 12).

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F_prime(X)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation because it generates many inputs across the domain, catches edge cases manual tests miss, and gives strong guarantees that behavior is unchanged for all non-buggy inputs. Capture the unfixed behavior first, then assert the fixed code reproduces it.

**Test Cases**:
1. **Authorized ingest preservation (3.1, 3.2, 3.4)**: An authenticated, normally-sized Modo A/B capture still triggers `renderizar_exportacao` and yields the final video at `videos_gerados`.
2. **Script approval preservation (3.3)**: Authenticated `aprovado=true` still persists the script and triggers `rerenderizar_com_roteiro_aprovado`.
3. **Simlink data preservation (3.5)**: For random module sets, paginated `GET /api/v1/modulos` results concatenated in order equal the original unpaginated result; `GET /api/v1/simlink/{id}` and conclusao + LMS callback are unchanged.
4. **TTS/artifacts/regerar/sandbox preservation (3.6)**: These authorized routes return the same results as before.
5. **Static assets preservation (3.7)**: All mounts still serve their assets.
6. **Test discovery preservation (3.8)**: Relocated `test_timebender.py` is discovered and passes.

### Unit Tests

- CORS: allowed origin accepted, disallowed origin rejected, no wildcard+credentials combination.
- Auth dependency: valid JWT → pass; missing/invalid/expired → `401`.
- Health: `GET /api/v1/health` → `200 {"status":"ok"}`.
- Modo C: ingest with `modo_input="C"` → rejected; Modo A/B → accepted.
- Pagination: `limit`/`offset` boundaries (0, 1, > total) on `/api/v1/modulos`.
- Requirements: import smoke test for `api.main` and `video_eng.time_bender` after clean install.

### Property-Based Tests

- **Auth (Property 1/2)**: Generate random data-route requests with/without valid tokens; assert `401` iff unauthenticated, identical responses when authorized.
- **Pagination equivalence (Property 5/6)**: Generate random module collections and page sizes; assert pages concatenate (in order) to the full result and event loop is not blocked.
- **Upload equivalence (Property 3/4)**: Generate random normally-sized recordings; assert the backend receives a semantically equivalent payload via binary upload vs. the original base64 path (same persisted artifacts).
- **Modo preservation (Property 4)**: Generate Modo A and Modo B captures; assert pipeline output is unchanged while Modo C is rejected.

### Integration Tests

- Full authenticated capture → ingest (binary upload) → `renderizar_exportacao` → roteiro_pronto → approval → `rerenderizar_com_roteiro_aprovado` → final video at `videos_gerados`.
- Simlink flow: list (paginated) → fetch module → record conclusao → LMS callback.
- Extension flow: configurable endpoint resolution + IndexedDB event persistence across a session, with no event loss under many interactions.
- Deploy probe: `GET /api/v1/health` succeeds for readiness/liveness.
