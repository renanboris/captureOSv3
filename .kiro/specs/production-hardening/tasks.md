# Implementation Plan

## Overview

This plan follows the exploratory bugfix workflow: write tests that surface the bug
BEFORE the fix (exploration), capture existing behavior that must not change
(preservation), then implement the targeted fixes and validate. Property numbers map
directly to the **Correctness Properties** in `design.md` so hover status and
traceability stay aligned.

- Bug Condition `C(X)` = disjunction `C1..C15` (see `design.md` → Bug Details).
- Bug-condition exploration tests (Properties 1, 3, 5, 7, 8, 9, 10, 11) MUST FAIL on
  unfixed code.
- Preservation tests (Properties 2, 4, 6, 12) MUST PASS on unfixed code.

The project uses `pytest` (tests under `tests/`); property-based tests use `hypothesis`.

## Task Dependency Graph

Tasks are grouped into waves. Each wave depends on the completion of the previous wave.
Wave 1 sets up PBT infra. Wave 2 writes all exploration/preservation tests (independent,
parallelizable). Wave 3 implements Phase 0 fixes and re-verifies. Wave 4 implements Phase 1
fixes and re-verifies. Wave 5 is the final checkpoint.

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["0"],
      "description": "Set up property-based testing infrastructure"
    },
    {
      "wave": 2,
      "tasks": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
      "dependsOn": ["0"],
      "description": "Write bug-condition exploration tests (must fail) and preservation tests (must pass) on unfixed code"
    },
    {
      "wave": 3,
      "tasks": ["13.1", "13.2", "13.3", "13.4", "13.5", "13.6"],
      "dependsOn": ["4", "5", "6", "7", "12"],
      "description": "Phase 0 implementation: runnability, hygiene, SDK, health probe; re-verify"
    },
    {
      "wave": 4,
      "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5", "14.6", "14.7", "14.8", "14.9"],
      "dependsOn": ["1", "2", "3", "8", "9", "10", "11", "13.6"],
      "description": "Phase 1 implementation: CORS, auth, extension transport, module I/O, Modo C; re-verify"
    },
    {
      "wave": 5,
      "tasks": ["15"],
      "dependsOn": ["13.6", "14.9"],
      "description": "Final checkpoint: all tests pass with no regressions"
    }
  ]
}
```

## Tasks

- [x] 0. Set up property-based testing infrastructure
  - Add `hypothesis` and `httpx` (FastAPI `TestClient` deps) to a dev/test requirements list
  - Confirm `pytest` discovers tests under `tests/` (existing convention)
  - Add a `tests/conftest.py` with shared fixtures: FastAPI app/`TestClient`, a temp `data/simlink` fixture for module I/O, and a valid/invalid JWT factory
  - This is test scaffolding only — it does NOT modify product code or implement any fix
  - _Requirements: 2.7_

### Bug Condition Exploration Tests (write BEFORE the fix — these MUST FAIL on unfixed code)

- [x] 1. Write bug condition exploration test — CORS and authentication lockdown
  - **Property 1: Bug Condition** - CORS and Authentication Lockdown
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it validates the fix when it passes after implementation
  - **GOAL**: Surface counterexamples for C1 (CORS `*` + credentials) and C2 (unauthenticated data routes)
  - **PBT approach**: Generate random data routes (ingest, roteiro read/write, regerar, tts preview, artifacts, simlink, sandbox) and random auth states; assert unauthenticated requests are rejected with `401` for ALL data routes
  - Send a cross-origin credentialed request from a disallowed origin (e.g. `https://evil.example`); assert it is NOT accepted and that no response ever pairs wildcard origin with `allow_credentials=true`
  - Assert `POST /api/v1/capture/ingest` and `POST /api/v1/session/{id}/roteiro?aprovado=true` with no auth do NOT trigger the pipeline
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (anonymous calls return `200` + trigger pipeline; disallowed origin accepted)
  - Document counterexamples found (e.g. "ingest with no token returned 200 and triggered renderizar_exportacao")
  - _Bug_Condition: isBugCondition(X) where C1(X) OR C2(X)_
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 2. Write bug condition exploration test — Extension endpoint and transport correctness
  - **Property 3: Bug Condition** - Extension Endpoint and Transport Correctness
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **GOAL**: Surface counterexamples for C3 (hardcoded `localhost`), C4 (base64-in-JSON upload), C5 (`chrome.storage.local` quota)
  - **Scoped PBT Approach**: For C4, generate normally-large recordings and assert the ingest contract accepts a binary upload (`multipart/form-data`/`UploadFile`) rather than a base64 `video_webm: str`; on unfixed code the route only accepts the base64 string field
  - C3 (static assertion): assert `extension/background.js` resolves the backend endpoint from `chrome.storage` with no hardcoded `http://localhost:8000` and no missing configuration override
  - C5 (storage): simulate ~50 × ~200 KB events; assert persistence target is IndexedDB (not `chrome.storage.local`) so nothing is lost to the ~5 MB quota
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (localhost is hardcoded; ingest requires base64 string; events use `chrome.storage.local`)
  - Document counterexamples found
  - _Bug_Condition: isBugCondition(X) where C3(X) OR C4(X) OR C5(X)_
  - _Requirements: 1.3, 1.4, 1.5, 2.3, 2.4, 2.5_

- [x] 3. Write bug condition exploration test — Non-blocking module I/O with pagination
  - **Property 5: Bug Condition** - Non-Blocking Module I/O with Pagination
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **GOAL**: Surface counterexamples for C8 (synchronous `glob` scan on the event loop, no pagination)
  - **PBT approach**: Generate random module collections in a temp `data/simlink` dir and random `limit`/`offset` values; assert `GET /api/v1/modulos` supports pagination parameters and returns the same module data per filter/page
  - Assert the handler does not perform a blocking synchronous scan inside the async route (e.g. assert `limit`/`offset` are accepted and the listing is offloaded/async)
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (no pagination params; synchronous `glob.glob(...)` runs on the event loop)
  - Document counterexamples found
  - _Bug_Condition: isBugCondition(X) where C8(X)_
  - _Requirements: 1.8, 2.8_

- [x] 4. Write bug condition exploration test — AI SDK currency
  - **Property 7: Bug Condition** - AI SDK Currency
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **Scoped PBT Approach**: Deterministic facet — scope to the concrete failing case: assert the resolved `google-genai` version is a supported current `1.x` (not the obsolete `0.3.0` pin)
  - Assert the Gemini model call sites in `api/intelligence_engine.py` use an API surface compatible with the current SDK
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (`google-genai==0.3.0` resolved)
  - Document counterexample found
  - _Bug_Condition: isBugCondition(X) where C6(X)_
  - _Requirements: 1.6, 2.6_

- [x] 5. Write bug condition exploration test — Clean install completeness
  - **Property 8: Bug Condition** - Clean Install Completeness
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **Scoped PBT Approach**: Deterministic facet — scope to concrete failing cases: assert every imported runtime dependency appears in `requirements.txt`, specifically `pydantic-settings` (imported by `config/settings.py`) and `static-ffmpeg` (imported by `video_eng/time_bender.py`)
  - Optionally drive an import smoke check of `api.main` and `video_eng.time_bender` against the declared manifest
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (`pydantic-settings` / `static-ffmpeg` absent from `requirements.txt`; import raises `ModuleNotFoundError`)
  - Document counterexamples found
  - _Bug_Condition: isBugCondition(X) where C7(X)_
  - _Requirements: 1.7, 2.7_

- [x] 6. Write bug condition exploration test — Repository hygiene
  - **Property 9: Bug Condition** - Repository Hygiene
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **Scoped PBT Approach**: Deterministic facet — scope to concrete failing cases (C9–C13)
  - Assert `legacy_agents/` is absent, `legacy_repos_tmp/` is absent, no root-level real session data (`session178_steps.json`), `test_timebender.py` lives under `tests/`, `.env.example` exists, and `.gitignore` excludes session-data patterns (`data/`, scoped `session*_steps.json`, `session_*`, `legacy_repos_tmp/`)
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (legacy dirs, leaked data, and misplaced test present; `.env.example` missing; `.gitignore` gaps)
  - Document counterexamples found
  - _Bug_Condition: isBugCondition(X) where C9(X) OR C10(X) OR C11(X) OR C12(X) OR C13(X)_
  - _Requirements: 1.9, 1.10, 1.11, 1.12, 1.13, 2.9, 2.10, 2.11, 2.12, 2.13_

- [x] 7. Write bug condition exploration test — Health probe availability
  - **Property 10: Bug Condition** - Health Probe Availability
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **Scoped PBT Approach**: Deterministic facet — scope to the concrete failing case: `GET /api/v1/health`
  - Assert `GET /api/v1/health` returns a successful status (200) for readiness/liveness, unauthenticated
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (returns `404` — endpoint does not exist)
  - Document counterexample found
  - _Bug_Condition: isBugCondition(X) where C14(X)_
  - _Requirements: 1.14, 2.14_

- [x] 8. Write bug condition exploration test — Modo C disabled
  - **Property 11: Bug Condition** - Modo C Disabled
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **Scoped PBT Approach**: Deterministic facet — scope to the concrete failing case: ingest with `modo_input == "C"` and a `roteiro_manual` payload
  - Assert a capture with `modo_input="C"` is rejected/disabled (`422`/`400` or explicit "unsupported")
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (Modo C path executes the undocumented manual branch)
  - Document counterexample found
  - _Bug_Condition: isBugCondition(X) where C15(X)_
  - _Requirements: 1.15, 2.15_

### Preservation Tests (write BEFORE the fix — these MUST PASS on unfixed code)

Follow the observation-first methodology: run the UNFIXED code for non-bug-condition
inputs (`C(X)` is false), record actual outputs, then write property-based tests that
assert those observed outputs across the input domain.

- [x] 9. Write preservation property tests — Authorized data-route behavior
  - **Property 2: Preservation** - Authorized Data-Route Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: authorized/allowed-origin calls to ingest, `roteiro` read/write (`aprovado=true`), `regerar`, `tts/preview`, `artifacts`, simlink, and sandbox routes — record status codes, response bodies, and side effects (pipeline triggers, persistence, LMS callbacks)
  - **PBT approach**: Generate random valid requests across these routes (treating unfixed code as having no auth gate, i.e. the baseline accepts them); assert the fixed system, given valid auth, reproduces the SAME status code, body, and side effects
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (baseline behavior captured for authorized flows)
  - _Preservation: For all X where NOT isBugCondition(X), F(X) = F'(X) for data routes_
  - _Requirements: 3.1, 3.3, 3.5, 3.6_

- [x] 10. Write preservation property tests — Capture-to-pipeline result equivalence
  - **Property 4: Preservation** - Capture-to-Pipeline Result Equivalence
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: a normally-sized Modo A and Modo B capture triggers `renderizar_exportacao` and yields the final video at the existing `videos_gerados` URL
  - **PBT approach**: Generate random normally-sized Modo A/B captures; assert the payload delivered to the backend is semantically equivalent (same `session_id`, events, video bytes, audio, `modo_input`) so the pipeline trigger and final-video output are identical to baseline
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (baseline capture→pipeline output captured)
  - _Preservation: For all X where NOT isBugCondition(X), capture→pipeline output unchanged_
  - _Requirements: 3.1, 3.2, 3.4_

- [x] 11. Write preservation property tests — Module data and completion equivalence
  - **Property 6: Preservation** - Module Data and Completion Equivalence
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: `GET /api/v1/modulos`, `GET /api/v1/simlink/{id}`, and `POST /api/v1/simlink/{id}/conclusao` (with LMS callback) outputs for known module sets
  - **PBT approach**: Generate random module collections and page sizes; assert the concatenation of paginated pages (in order) equals the original full unpaginated result, and that single-module fetch and conclusao + LMS callback are unchanged
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (baseline module data/completion captured)
  - _Preservation: For all X where NOT isBugCondition(X), module data/completions unchanged_
  - _Requirements: 3.5_

- [x] 12. Write preservation property tests — Static asset serving and test discovery
  - **Property 12: Preservation** - Static Asset Serving and Test Discovery
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: each `StaticFiles` mount (`/videos_gerados`, `/editor`, `/artifacts`, `/screenshots`, `/simlink`, `/scorm`, `/audios`, `/scorm-player`) serves its assets
  - Assert the existing time-bender tests pass (these will move to `tests/` during the fix and must still be discovered and pass)
  - **Scoped PBT Approach**: Generate requests across the set of mount points; assert each still resolves to its asset
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (baseline static serving and time-bender tests captured)
  - _Preservation: For all X where NOT isBugCondition(X), static mounts and test discovery unchanged_
  - _Requirements: 3.7, 3.8_

### Phase 0 — Implementation: Technical-debt cleanup and runnability

- [x] 13. Fix repo hygiene, runnability, and health probe (Phase 0)

  - [x] 13.1 Make `requirements.txt` complete and the SDK current
    - Add `pydantic-settings` (imported by `config/settings.py`) and `static-ffmpeg` (imported by `video_eng/time_bender.py`), plus any other actually-imported-but-unlisted runtime deps found while validating a clean install
    - Bump `google-genai` from `0.3.0` to a supported current `1.x` version
    - Adapt the Gemini model call sites in `api/intelligence_engine.py` (and any other genai call sites) to the new API surface
    - _Bug_Condition: isBugCondition(X) where C7(X) OR C6(X)_
    - _Expected_Behavior: expectedBehavior(result) — clean install succeeds; current SDK resolved (design Properties 7, 8)_
    - _Requirements: 2.6, 2.7_

  - [x] 13.2 Remove dead code and leaked data; relocate the orphaned test
    - Archive `legacy_agents/` (and `capture/auth.py` if part of the dead browser-automation set) to an archive branch, then delete from `main`
    - Delete `legacy_repos_tmp/` (keep it gitignored)
    - Delete `session178_steps.json` from the repo root
    - Move `test_timebender.py` from the root into `tests/`, fixing imports/paths as needed
    - _Bug_Condition: isBugCondition(X) where C9(X) OR C10(X) OR C11(X) OR C12(X)_
    - _Expected_Behavior: expectedBehavior(result) — clean repo, test under tests/ (design Property 9)_
    - _Preservation: relocated time-bender tests still discovered and pass (3.8)_
    - _Requirements: 2.9, 2.10, 2.11, 2.12_

  - [x] 13.3 Add `.env.example` and harden `.gitignore`
    - Add `.env.example` documenting every required setting (API, storage, IA keys, redis, supabase/jwt, allowed origins, extension ID)
    - Extend `.gitignore` to exclude session-data patterns (scoped, e.g. root-level `session*_steps.json`, `session_*`) without ignoring config JSON that must be tracked
    - _Bug_Condition: isBugCondition(X) where C13(X)_
    - _Expected_Behavior: expectedBehavior(result) — config discoverable; sensitive data excluded (design Property 9)_
    - _Requirements: 2.13_

  - [x] 13.4 Add the `/api/v1/health` endpoint
    - Add `GET /api/v1/health` to `api/main.py` returning `{"status": "ok"}` (200), unauthenticated, for readiness/liveness
    - _Bug_Condition: isBugCondition(X) where C14(X)_
    - _Expected_Behavior: expectedBehavior(result) — health 200 (design Property 10)_
    - _Requirements: 2.14_

  - [x] 13.5 Verify Phase 0 exploration tests now pass
    - **Property 7: Expected Behavior** - AI SDK Currency
    - **Property 8: Expected Behavior** - Clean Install Completeness
    - **Property 9: Expected Behavior** - Repository Hygiene
    - **Property 10: Expected Behavior** - Health Probe Availability
    - **IMPORTANT**: Re-run the SAME tests from tasks 4, 5, 6, 7 — do NOT write new tests
    - **EXPECTED OUTCOME**: Tests PASS (confirms these facets are fixed)
    - _Requirements: 2.6, 2.7, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14_

  - [x] 13.6 Verify Phase 0 preservation tests still pass
    - **Property 12: Preservation** - Static Asset Serving and Test Discovery
    - **IMPORTANT**: Re-run the SAME tests from task 12 — do NOT write new tests
    - **EXPECTED OUTCOME**: Tests PASS (static mounts unchanged; relocated time-bender tests discovered and pass — no regressions)
    - _Requirements: 3.7, 3.8_

### Phase 1 — Implementation: Minimum production security

- [x] 14. Fix production security defects (Phase 1)

  - [x] 14.1 Lock down CORS
    - Replace `allow_origins=["*"]` in `api/main.py` with an explicit allow-list from settings (extension origin `chrome-extension://<ID>` and the deployed backend host)
    - Keep `allow_credentials=True` only with the explicit list; never pair it with `"*"`
    - Add `allowed_origins` (and extension ID) fields to `config/settings.py`
    - _Bug_Condition: isBugCondition(X) where C1(X)_
    - _Expected_Behavior: expectedBehavior(result) — disallowed origins rejected; no wildcard+credentials (design Property 1)_
    - _Preservation: allowed-origin authorized requests behave as before (3.1, 3.3, 3.5, 3.6)_
    - _Requirements: 2.1_

  - [x] 14.2 Require authentication on all data routes
    - Implement a FastAPI dependency (new `api/auth.py` or `api/dependencies.py`) that validates a bearer JWT against `supabase_url` / `supabase_anon_key` / `jwt_secret`
    - Apply the dependency to every data route (ingest, script read/write, regerar, tts preview, artifacts, simlink, sandbox); return `401` on missing/invalid credentials
    - Do NOT repurpose `capture/auth.py` (removed with the legacy code in 13.2)
    - _Bug_Condition: isBugCondition(X) where C2(X)_
    - _Expected_Behavior: expectedBehavior(result) — 401 for unauthenticated data-route requests (design Property 1)_
    - _Preservation: authorized data-route results identical to baseline (3.1, 3.3, 3.5, 3.6)_
    - _Requirements: 2.2_

  - [x] 14.3 Make the extension backend endpoint configurable
    - Remove the hardcoded `const BACKEND_URL = "http://localhost:8000"` in `extension/background.js`
    - Resolve the endpoint at runtime from `chrome.storage` (populated by an options/settings page); document a dev-only fallback
    - Attach the auth token (from 14.2) to outgoing requests
    - _Bug_Condition: isBugCondition(X) where C3(X)_
    - _Expected_Behavior: expectedBehavior(result) — endpoint resolved from configurable storage (design Property 3)_
    - _Requirements: 2.3_

  - [x] 14.4 Replace base64-in-JSON upload with binary / pre-signed upload
    - Replace base64 `finalizeUpload()` in `extension/background.js` with `multipart/form-data` (or pre-signed S3/R2 PUT then notify backend)
    - Change the ingest route in `api/main.py` to accept an uploaded file (e.g. `UploadFile`) instead of `video_webm: str`; adapt `EventPayload`
    - Update `renderizar_exportacao` (`api/export_pipeline.py`) to read raw bytes from the uploaded file/stored object instead of `base64.b64decode(payload["video_webm"])`
    - _Bug_Condition: isBugCondition(X) where C4(X)_
    - _Expected_Behavior: expectedBehavior(result) — binary upload completes (design Property 3)_
    - _Preservation: normally-sized captures deliver a semantically equivalent payload; pipeline + final video unchanged (3.1, 3.2)_
    - _Requirements: 2.4_

  - [x] 14.5 Move extension event storage to IndexedDB
    - Persist `eventsLog` entries (timestamp, type, eventData, screenshotData) in IndexedDB instead of `chrome.storage.local`
    - On finalize, read events back from IndexedDB; surface an error to the user if persistence fails (no silent loss)
    - _Bug_Condition: isBugCondition(X) where C5(X)_
    - _Expected_Behavior: expectedBehavior(result) — events persisted in IndexedDB, none lost to quota (design Property 3)_
    - _Requirements: 2.5_

  - [x] 14.6 Make module I/O non-blocking and add pagination
    - Offload the `glob` + file reads in `listar_modulos`, `get_simlink_modulo`, and `registrar_conclusao_simlink` (`api/main.py`) using `asyncio.to_thread` (or async file API) so the event loop is not blocked
    - Add `limit`/`offset` (or page/page_size) to `GET /api/v1/modulos`, returning the same ordering with pagination metadata
    - _Bug_Condition: isBugCondition(X) where C8(X)_
    - _Expected_Behavior: expectedBehavior(result) — non-blocking I/O + pagination; same module data per page (design Property 5)_
    - _Preservation: pages concatenated in order equal the original unpaginated result; conclusao + LMS callback unchanged (3.5)_
    - _Requirements: 2.8_

  - [x] 14.7 Disable the Modo C path
    - Reject `modo_input == "C"` at the ingest boundary in `api/main.py` (`422`/`400` with a clear message) or short-circuit the Modo C branch in `api/export_pipeline.py`, leaving Modo A/B untouched
    - _Bug_Condition: isBugCondition(X) where C15(X)_
    - _Expected_Behavior: expectedBehavior(result) — Modo C rejected/disabled (design Property 11)_
    - _Preservation: Modo A and Modo B narration/audio processing unchanged (3.4)_
    - _Requirements: 2.15_

  - [x] 14.8 Verify Phase 1 exploration tests now pass
    - **Property 1: Expected Behavior** - CORS and Authentication Lockdown
    - **Property 3: Expected Behavior** - Extension Endpoint and Transport Correctness
    - **Property 5: Expected Behavior** - Non-Blocking Module I/O with Pagination
    - **Property 11: Expected Behavior** - Modo C Disabled
    - **IMPORTANT**: Re-run the SAME tests from tasks 1, 2, 3, 8 — do NOT write new tests
    - **EXPECTED OUTCOME**: Tests PASS (confirms these facets are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8, 2.15_

  - [x] 14.9 Verify Phase 1 preservation tests still pass
    - **Property 2: Preservation** - Authorized Data-Route Behavior
    - **Property 4: Preservation** - Capture-to-Pipeline Result Equivalence
    - **Property 6: Preservation** - Module Data and Completion Equivalence
    - **IMPORTANT**: Re-run the SAME tests from tasks 9, 10, 11 — do NOT write new tests
    - **EXPECTED OUTCOME**: Tests PASS (authorized flows, capture→pipeline output, and module data/completions unchanged — no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

### Final Checkpoint

- [x] 15. Checkpoint — Ensure all tests pass
  - Run the full suite: all bug-condition exploration tests (Properties 1, 3, 5, 7, 8, 9, 10, 11) now PASS
  - All preservation tests (Properties 2, 4, 6, 12) still PASS (no regressions)
  - Run the integration flows from the design: authenticated capture → binary-upload ingest → `renderizar_exportacao` → roteiro_pronto → approval → `rerenderizar_com_roteiro_aprovado` → final video at `videos_gerados`; paginated simlink flow; extension endpoint + IndexedDB persistence; `GET /api/v1/health` probe
  - Ensure all tests pass; ask the user if questions arise
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

## Notes

- **Test-first ordering is mandatory.** Tasks 1–8 (exploration) must FAIL on unfixed code
  and tasks 9–12 (preservation) must PASS on unfixed code before any fix in tasks 13–14.
- **Property numbers are stable.** Each `**Property N:**` label matches the numbered
  Correctness Property in `design.md` to keep hover status and traceability aligned. The
  same test from the exploration phase is re-run (not rewritten) under
  `**Property N: Expected Behavior**` after the fix.
- **Phase 0 before Phase 1.** Phase 0 makes the repo installable/runnable (so the test
  harness and `api.main` import cleanly) and removes the legacy code that Phase 1's auth
  work must not repurpose.
- **PBT facets** (auth, pagination, upload equivalence, Modo A/B preservation) use
  `hypothesis` for large input domains; deterministic facets (SDK pin, dependency
  completeness, hygiene, health, Modo C) are scoped to concrete failing cases.
- **Out of scope:** cloud sharing/storage before authentication exists (per `bugfix.md`).
