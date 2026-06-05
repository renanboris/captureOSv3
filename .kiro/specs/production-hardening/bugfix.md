# Bugfix Requirements Document

## Introduction

CaptureOS v3 is being prepared for its first production deployment. A source-level audit of the repository confirmed a family of defects that make the system **production-unsafe** (it can be abused or will fail under real-world load) and **repo-unrunnable** (a clean checkout cannot be installed or run reliably). This bugfix treats those confirmed P0/P1 defects, plus the associated Phase 0 technical-debt cleanup, as bugs to be fixed under a single systematic hardening effort.

The effort spans two phases:

- **Phase 0 — Technical-debt cleanup:** remove dead/legacy code, leaked data, and orphaned files from the repository root, and make the repository installable and probeable by a new contributor or CI/CD pipeline.
- **Phase 1 — Minimum production security:** lock down CORS, require authentication on all data routes, make the extension backend endpoint configurable, and replace the oversized base64 video upload and the storage/event-loop bottlenecks that guarantee failure at scale.

The unifying bug condition is the family of "production-unsafe / repo-unrunnable" states: unauthenticated mutations, an over-permissive CORS policy, oversized base64 payloads, a hardcoded `localhost` endpoint in a published build, missing runtime dependencies, blocking I/O on the async event loop, leaked data committed to a public repo, and unsupported/undocumented code paths shipped to users. The fix eliminates those states. Preservation requires that every legitimate capture → pipeline → export flow continues to work exactly as before once hardening is applied.

Out of scope (non-goals, not addressed by this bugfix): implementing cloud sharing or cloud storage of any kind before authentication exists.

## Bug Analysis

### Current Behavior (Defect)

The following clauses describe what currently happens. Each was verified against the cited source.

1.1 WHEN the API receives a cross-origin request THEN the system accepts it from any origin because `CORSMiddleware` is configured with `allow_origins=["*"]` together with `allow_credentials=True` (`api/main.py`), an unsafe combination that exposes credentialed endpoints to arbitrary websites.

1.2 WHEN any caller who knows the backend URL invokes a data route (e.g. `POST /api/v1/capture/ingest`, `POST /api/v1/session/{id}/roteiro` with `aprovado=true`, `GET /api/v1/session/{id}/roteiro`, the simlink/sandbox routes) THEN the system processes the request without any authentication, allowing unauthenticated session injection, script overwrite that triggers GPU/AI re-rendering, script reads, and data deletion.

1.3 WHEN the published extension runs on an end user's machine THEN the system calls `http://localhost:8000` because `BACKEND_URL` is hardcoded in `extension/background.js` and no build step or runtime configuration substitutes it, so every request targets the user's own machine instead of the deployed backend.

1.4 WHEN a recording is finalized THEN the system serializes the entire WebM video to base64 and sends it inside a single JSON `POST /api/v1/capture/ingest` (`finalizeUpload()` in `background.js`, `video_webm: str` in `EventPayload`), so a ~10-minute recording produces a 400–800 MB payload that causes network timeouts and Service Worker memory exhaustion and reliably fails on long recordings.

1.5 WHEN the user performs many interactions during a recording THEN the system appends PNG screenshots to `eventsLog` in `chrome.storage.local`, which silently exceeds the ~5 MB default quota (≈50 clicks × ≈200 KB), and events are lost without notifying the user.

1.6 WHEN the AI pipeline runs against the pinned `google-genai==0.3.0` dependency THEN the system relies on an SDK version that is several major versions behind the current 1.x line, leaving the referenced Gemini 2.5 Flash usage untested against the current API and at near-term risk of breakage.

1.7 WHEN a new contributor or CI/CD runs a clean `pip install -r requirements.txt` THEN the system fails at startup because `pydantic-settings` (imported in `config/settings.py`) and `static-ffmpeg` (imported in `time_bender.py`) are not listed in `requirements.txt`.

1.8 WHEN `GET /api/v1/modulos` or `POST /api/v1/simlink/{id}/conclusao` is called THEN the system runs a synchronous `glob.glob("data/simlink/*.json")` scan inside an async route, blocking the event loop, performing an O(n) file scan on every request, with no pagination.

1.9 WHEN the repository is checked out THEN the system still contains `legacy_agents/` (dead v1/v2 browser-automation code: `browser_probe.py`, `main.py`, `orchestration/`), which is unused and adds confusion and maintenance burden.

1.10 WHEN the repository is checked out THEN the system still contains `legacy_repos_tmp/`, a migration artifact referencing old repositories that should not be part of the codebase.

1.11 WHEN the repository is viewed THEN the system exposes `session178_steps.json` committed at the repo root, leaking real session data in a public repository.

1.12 WHEN the test suite is located THEN the system has `test_timebender.py` orphaned at the repo root instead of under `tests/`, breaking test discovery conventions.

1.13 WHEN a new contributor sets up the project THEN the system provides no `.env.example` and a `.gitignore` that does not exclude session-data patterns (e.g. `*.json`, `session_*`) beyond `data/`, so required configuration is undiscoverable and sensitive data is at risk of being committed.

1.14 WHEN a load balancer or deployment process probes the backend THEN the system offers no `/api/v1/health` endpoint, preventing readiness/liveness checks and zero-downtime deploys.

1.15 WHEN a capture is submitted with `modo_input="C"` (`roteiro_manual` Modo C, implemented in `export_pipeline.py`) THEN the system executes a code path that has no UI, no documentation, and no tests, and that contradicts the core value proposition.

### Expected Behavior (Correct)

Each clause below defines the correct behavior for the same condition as the matching clause above.

2.1 WHEN the API receives a cross-origin request THEN the system SHALL only accept requests from explicitly allowed origins — the extension origin (`chrome-extension://[ID]`) and the deployed backend host — and SHALL NOT combine a wildcard origin with credentialed access.

2.2 WHEN any caller invokes a data route (ingest, script read/write, simlink, sandbox, and other mutating or data-returning routes) THEN the system SHALL require valid authentication and SHALL reject unauthenticated requests with a 401, using freshly built production auth backed by the existing `supabase_url` / `supabase_anon_key` / `jwt_secret` settings (the legacy Playwright auto-login in `capture/auth.py` SHALL be removed with the legacy code, not repurposed as API auth).

2.3 WHEN the published extension runs on an end user's machine THEN the system SHALL resolve the backend endpoint from configurable storage (a settings/options page backed by `chrome.storage`) rather than a hardcoded `localhost` value, so requests target the correct deployed backend.

2.4 WHEN a recording is finalized THEN the system SHALL upload the video as binary (`multipart/form-data` or a pre-signed S3/R2 upload) rather than base64-in-JSON, so long recordings upload without network timeouts or Service Worker memory exhaustion.

2.5 WHEN the user performs many interactions during a recording THEN the system SHALL persist screenshots and events in IndexedDB (not `chrome.storage.local`), so events are not silently lost to the 5 MB quota.

2.6 WHEN the AI pipeline runs THEN the system SHALL depend on a supported, current `google-genai` SDK version with the referenced Gemini model usage verified to work against that version.

2.7 WHEN a new contributor or CI/CD runs a clean `pip install -r requirements.txt` THEN the system SHALL install successfully, with `pydantic-settings` and `static-ffmpeg` (and any other actually-imported runtime dependencies) listed in `requirements.txt`.

2.8 WHEN `GET /api/v1/modulos` or `POST /api/v1/simlink/{id}/conclusao` is called THEN the system SHALL perform module lookups without blocking the event loop (e.g. async/offloaded I/O) and SHALL support pagination for listing.

2.9 WHEN the repository is checked out THEN the system SHALL NOT contain `legacy_agents/`; the dead v1/v2 code SHALL be moved to an archive branch and removed from `main`.

2.10 WHEN the repository is checked out THEN the system SHALL NOT contain `legacy_repos_tmp/`; it SHALL be deleted and added to `.gitignore`.

2.11 WHEN the repository is viewed THEN the system SHALL NOT contain `session178_steps.json` or any other real session data at the repo root; it SHALL be deleted and excluded via `.gitignore`.

2.12 WHEN the test suite is located THEN the system SHALL contain `test_timebender.py` under `tests/`, consistent with test-discovery conventions.

2.13 WHEN a new contributor sets up the project THEN the system SHALL provide a `.env.example` documenting required configuration, and `.gitignore` SHALL exclude session-data patterns (e.g. `data/`, `*.json`, `session_*`) so sensitive data cannot be committed accidentally.

2.14 WHEN a load balancer or deployment process probes the backend THEN the system SHALL expose a `/api/v1/health` endpoint that returns a successful health status for readiness/liveness checks.

2.15 WHEN a capture is submitted with `modo_input="C"` THEN the system SHALL reject or disable the Modo C path until a documented, UI-supported, tested use case exists.

### Unchanged Behavior (Regression Prevention)

The following legitimate flows must continue to work identically after hardening.

3.1 WHEN an authenticated, correctly configured client submits a valid, normally-sized recording to `POST /api/v1/capture/ingest` THEN the system SHALL CONTINUE TO accept it and trigger the decoupled export pipeline (`renderizar_exportacao`).

3.2 WHEN the capture → AI → video pipeline runs for a valid session THEN the system SHALL CONTINUE TO produce the final video and expose it at the existing `videos_gerados` URL.

3.3 WHEN an authorized client saves a script with `aprovado=true` via `POST /api/v1/session/{id}/roteiro` THEN the system SHALL CONTINUE TO persist the script and trigger final re-rendering (`rerenderizar_com_roteiro_aprovado`).

3.4 WHEN a capture uses Modo A (auto narration) or Modo B (instructor microphone) THEN the system SHALL CONTINUE TO process narration and audio exactly as before.

3.5 WHEN clients call the simlink routes (`GET /api/v1/modulos`, `GET /api/v1/simlink/{id}`, `POST /api/v1/simlink/{id}/conclusao`) for existing modules THEN the system SHALL CONTINUE TO return the correct module data and record completions, including LMS callbacks.

3.6 WHEN clients use TTS preview, artifact retrieval, script regeneration, and sandbox evaluation/reset routes THEN the system SHALL CONTINUE TO return the same results as before.

3.7 WHEN clients request static assets (videos, audios, editor, simlink, scorm, screenshots) THEN the system SHALL CONTINUE TO serve them from their existing mount points.

3.8 WHEN the test suite runs after `test_timebender.py` is relocated to `tests/` THEN the system SHALL CONTINUE TO discover and pass the existing time-bender tests.
