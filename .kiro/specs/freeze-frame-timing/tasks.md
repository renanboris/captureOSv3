# Implementation Plan

## Overview

This plan follows the exploratory bugfix workflow: write tests that surface the
bug BEFORE fixing (exploration), write tests that lock in current good behavior
BEFORE fixing (preservation), then apply the fix and verify both. All timing
tests target the pure function `_calculate_segments(timeline_events,
video_duration)` in `video_eng/time_bender.py`, so they are cheap to run without
rendering video. Use Hypothesis (`from hypothesis import given, settings,
strategies as st`) following the existing repo conventions in `tests/`.

Suggested test files:
- Exploration / fix-checking: `tests/test_bug_freeze_frame_timing.py`
- Preservation: `tests/test_preservation_freeze_frame_timing.py`

## Tasks

- [x] 1. Write bug condition exploration test — loading narrations are frozen
  - **Property 1: Bug Condition** - Loading narrations play, not freeze
  - **CRITICAL**: This test MUST FAIL on the unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate loading events are incorrectly frozen
  - **Scoped PBT Approach**: Generate timelines containing at least one `{"is_loading": True}` event (varied `timestamp`, `audio_duration`); the bug is deterministic so any such event reproduces it
  - Bug Condition: `isBugCondition` returns True whenever `event.is_loading` is true (from design Bug Condition / clause 1.1)
  - Expected Behavior assertion: for a loading event, `_calculate_segments` SHALL NOT emit a `("freeze", ...)` segment attributable to that event; instead it emits running `("video", ...)` coverage spanning the narration, with the event's audio positioned over the running segment (from design Property 1)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS — the unfixed code has no `is_loading` concept and always appends a `("freeze", ...)` segment per event
  - Document counterexample (e.g. "event {ts: 6.0, dur: 2.5, is_loading: True} produces a 2.5s freeze on a half-loaded frame at ~5.8s instead of running video from 6.0s")
  - Mark task complete when the test is written, run, and the failure is documented
  - _Requirements: 2.1_

- [x] 2. Write bug condition exploration test — click freeze lands off-target
  - **Property 2: Bug Condition** - Click freeze lands on the correct-target frame
  - **CRITICAL**: This test MUST FAIL on the unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples showing the freeze is anchored at a fixed offset before the click instead of on the click frame
  - **Scoped PBT Approach**: Generate non-loading click timelines (varied `timestamp`, `audio_duration`, `video_duration`), including closely spaced clicks that trigger the `ts - 0.1` short-gap fallback; bugs are deterministic so concrete cases such as `ts = 4.0` and the pair `ts = 3.0, 3.15` reliably reproduce them
  - Bug Condition: for a non-loading event, `isBugCondition` returns True when `currentUnfixedFreezeFrame(ts, current_time)` (≈ `ts - 0.2`, fallback `ts - 0.1`) differs from `clamp(ts, current_time, video_duration - 0.1)` (from design Bug Condition / clauses 1.2, 1.3)
  - Expected Behavior assertion: the event's freeze segment time SHALL equal `clamp(ts, lower = current_time, upper = video_duration - 0.1)` — the click frame where the cursor is on the correct target — even when the gap before the click is too short to play any preceding video (from design Property 2)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS — unfixed code freezes at `ts - 0.2` (e.g. `3.8s` for `ts = 4.0`) or the `ts - 0.1` fallback (e.g. `3.05s` for the second of two clicks at `3.0`/`3.15`)
  - Document counterexamples (off-target freeze time and the short-gap fallback frame)
  - Mark task complete when the test is written, run, and the failure is documented
  - _Requirements: 2.2, 2.3_

- [x] 3. Write bug condition exploration test — FFmpeg and MoviePy timing diverge
  - **Property 3: Bug Condition** - Single shared timing rule across both paths
  - **CRITICAL**: This test MUST FAIL on the unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface that freeze timing is computed independently in two places, so identical input can yield different placement
  - **Scoped PBT Approach**: Generate valid `(timeline_events, video_duration)` and compare the timing produced by `_calculate_segments` against the timing the MoviePy fallback (`_compose_legacy_moviepy`) derives inline; extract/replicate the inline rule for comparison since the unfixed fallback re-derives it
  - Bug Condition: a timeline triggers the bug if the FFmpeg path and the MoviePy path can disagree on the resulting `(segments, audio_delays)` for the same input (from design Bug Condition / clause 1.4)
  - Expected Behavior assertion: both paths SHALL produce identical `(segments, audio_delays)` because both derive timing from the same `_calculate_segments` call, and there SHALL be no independent freeze-timing computation in `_compose_legacy_moviepy` (from design Property 3)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS / shows divergence — `_compose_legacy_moviepy` re-implements `safe_offset`/`freeze_ts` inline and can drift from `_calculate_segments`
  - Document the divergence (input where inline MoviePy timing differs from `_calculate_segments`)
  - Mark task complete when the test is written, run, and the failure/divergence is documented
  - _Requirements: 2.4_

- [x] 4. Write preservation property test — per-event freeze/audio structure (BEFORE implementing fix)
  - **Property 4: Preservation** - Per-event freeze/audio structure for non-loading timelines
  - **IMPORTANT**: Follow observation-first methodology
  - Non-bug condition: valid non-loading click timelines (cases where the structural contract must hold)
  - Observe on UNFIXED code: for a non-loading timeline, `_calculate_segments` emits exactly one `("freeze", _, dur)` segment per event with `dur` equal to that event's `audio_duration`, exactly one `audio_delays` entry per event, and exactly one trailing final `("freeze", _, 3.5)` segment
  - Write a property-based test asserting those counts/shapes hold across generated non-loading timelines (only freeze timestamps may change after the fix, not the structure) — from design Property 4 and Preservation Requirements
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test PASSES (confirms the baseline structural contract to preserve)
  - Mark task complete when the test is written, run, and passing on unfixed code
  - _Requirements: 3.1_

- [x] 5. Write preservation property test — one non-decreasing audio delay per event (BEFORE implementing fix)
  - **Property 5: Preservation** - One non-decreasing audio delay per event
  - **IMPORTANT**: Follow observation-first methodology
  - Non-bug condition: any valid timeline (loading or non-loading)
  - Observe on UNFIXED code: `_calculate_segments` emits exactly one `audio_delays` entry per event, in input order, with `delay_seconds` values non-decreasing along the expanded timeline, and each audio aligned to the start of its corresponding segment
  - Write a property-based test asserting: `len(audio_delays) == len(events)`, delays are non-decreasing, and each audio start aligns with its segment — from design Property 5 and Preservation Requirements (clauses 3.2, 3.3)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test PASSES (confirms the baseline audio-positioning contract to preserve)
  - Mark task complete when the test is written, run, and passing on unfixed code
  - _Requirements: 3.2, 3.3_

- [x] 6. Write preservation tests — routing behaviors unchanged (BEFORE implementing fix)
  - **Property 6: Preservation** - Routing behaviors unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Non-bug condition: inputs where the freeze-timing rule is not exercised
  - Observe on UNFIXED code and assert preserved after the fix:
    - Empty or all-invalid timeline → `compose_video_with_freeze_frames` performs a simple WebM→MP4 conversion with no freeze frames (delegates to `_simple_convert`) — clause 3.4
    - Missing input video → returns `False` without raising — clause 3.5
    - FFmpeg `filter_complex` failure (non-zero exit, invalid/empty output, timeout, or exception) → falls back to `_compose_legacy_moviepy` — clause 3.6
    - Public surface unchanged: `compose_video_with_freeze_frames` importable and `_calculate_segments(timeline_events, video_duration) -> (segments, audio_delays)` keeps the same shapes
  - These can be example-based / mocked routing tests (no real rendering required); from design Property 6 and Preservation Requirements
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms the baseline routing behavior to preserve)
  - Mark task complete when the tests are written, run, and passing on unfixed code
  - _Requirements: 3.4, 3.5, 3.6_

- [x] 7. Fix for freeze-frame timing (loading branch, click-frame anchor, single shared rule)

  - [x] 7.1 Thread the `is_loading` signal into events (backward-compatible)
    - In `compose_video_with_freeze_frames`, when building `valid_events`, copy an optional `is_loading` flag from each incoming event defaulting to `False`: `"is_loading": bool(event.get("is_loading", False))`
    - Keep the existing `{timestamp, audio_path}` input valid (treated as non-loading) so timelines that never set the flag preserve current structure
    - `time_bender` only consumes the flag; classification of loading micro-narrations is the caller's responsibility
    - _Bug_Condition: isBugCondition(event) where event.is_loading is true (design Bug Condition)_
    - _Expected_Behavior: loading events keep the recording running; non-loading events freeze on the click frame (design Property 1, Property 2)_
    - _Preservation: existing {timestamp, audio_path} input remains valid and non-loading (Preservation Requirements)_
    - _Requirements: 2.1_

  - [x] 7.2 Make `_calculate_segments` the single shared timing rule
    - Add the loading branch: for `event.is_loading`, emit running `("video", current_time, min(current_time + dur, video_duration))` coverage instead of a freeze; if the recording ends before the narration, hold the last frame for the remainder via `("freeze", max(0, video_duration - 0.1), remainder)`; append the audio delay over the running segment and advance `current_time`/`shifted_time`
    - For non-loading click events, replace the `safe_offset = 0.2` / `ts - 0.1` magic offsets with `freeze_ts = clamp(ts, lower = current_time, upper = video_duration - 0.1)` (the click frame); keep the preceding `("video", ...)` segment when `freeze_ts > current_time`, then append `("freeze", freeze_ts, dur)` and the audio delay
    - Preserve the trailing recording remainder `("video", current_time, video_duration)` and the trailing final `("freeze", max(0, video_duration - 0.1), 3.5)`
    - Follow the design's `_calculate_segments` pseudocode exactly
    - _Bug_Condition: isBugCondition(event, current_time, video_duration) — loading freeze and off-target click offset (design Bug Condition, clauses 1.1–1.3)_
    - _Expected_Behavior: expectedBehavior — loading → running coverage; click → freeze at clamp(ts, current_time, video_duration - 0.1) (design Property 1, Property 2)_
    - _Preservation: same counts/shapes for non-loading timelines; one non-decreasing audio delay per event; trailing 3.5s freeze (design Property 4, Property 5)_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 7.3 Refactor `_compose_legacy_moviepy` to consume the shared plan
    - Remove the inline `safe_offset` / `freeze_ts` block and the inline freeze/audio loop
    - Build `valid_events` exactly as the FFmpeg path does (skip missing audio files, compute each `audio_duration`, carry `is_loading`) and call `segments, audio_delays = _calculate_segments(valid_events, video.duration)`
    - Render from the shared plan: map `("video", start, end)` → `video.subclipped(start, end)`, `("freeze", t, d)` → `video.to_ImageClip(t=t).with_duration(d)`, concatenate, then place each audio with `AudioFileClip(path).with_start(delay)` from `audio_delays`
    - Do not change `_build_filter_complex`, `_simple_convert`, or the FFmpeg-failure fallback wiring
    - _Bug_Condition: isBugCondition — FFmpeg and MoviePy paths can diverge (design Bug Condition, clause 1.4)_
    - _Expected_Behavior: both paths derive identical (segments, audio_delays) from one _calculate_segments call (design Property 3)_
    - _Preservation: FFmpeg-failure fallback selection and routing unchanged (design Property 6)_
    - _Requirements: 2.4_

  - [x] 7.4 Verify the loading-narration exploration test now passes
    - **Property 1: Expected Behavior** - Loading narrations play, not freeze
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior; passing confirms loading events keep the recording running
    - **EXPECTED OUTCOME**: Test PASSES (confirms the loading-freeze defect is fixed)
    - _Requirements: 2.1_

  - [x] 7.5 Verify the click-frame exploration test now passes
    - **Property 2: Expected Behavior** - Click freeze lands on the correct-target frame
    - **IMPORTANT**: Re-run the SAME test from task 2 - do NOT write a new test
    - The test from task 2 encodes the expected behavior; passing confirms the freeze anchors on `clamp(ts, current_time, video_duration - 0.1)`
    - **EXPECTED OUTCOME**: Test PASSES (confirms the off-target / short-gap defects are fixed)
    - _Requirements: 2.2, 2.3_

  - [x] 7.6 Verify the path-divergence exploration test now passes
    - **Property 3: Expected Behavior** - Single shared timing rule across both paths
    - **IMPORTANT**: Re-run the SAME test from task 3 - do NOT write a new test
    - Passing confirms the FFmpeg and MoviePy paths produce identical `(segments, audio_delays)` from the shared `_calculate_segments`
    - **EXPECTED OUTCOME**: Test PASSES (confirms the duplication is removed)
    - _Requirements: 2.4_

  - [x] 7.7 Verify preservation tests still pass
    - **Property 4: Preservation** - Per-event freeze/audio structure for non-loading timelines
    - **Property 5: Preservation** - One non-decreasing audio delay per event
    - **Property 6: Preservation** - Routing behaviors unchanged
    - **IMPORTANT**: Re-run the SAME tests from tasks 4, 5, and 6 - do NOT write new tests
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in structure, audio ordering, or routing)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 8. Checkpoint - Ensure all tests pass
  - Run the full exploration, fix-checking, and preservation suite for the freeze-frame-timing spec
  - Confirm Properties 1–3 (bug condition → expected behavior) pass and Properties 4–6 (preservation) still pass
  - Clean up any temporary fixture/media files created during testing
  - Ensure all tests pass; ask the user if questions arise

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "description": "Standalone exploration (Properties 1-3) and preservation (Properties 4-6) tests written and run on the UNFIXED code, in parallel",
      "tasks": ["1", "2", "3", "4", "5", "6"]
    },
    {
      "wave": 2,
      "description": "Thread the backward-compatible is_loading signal into events",
      "tasks": ["7.1"]
    },
    {
      "wave": 3,
      "description": "Make _calculate_segments the single shared timing rule (loading branch + click-frame anchor)",
      "tasks": ["7.2"]
    },
    {
      "wave": 4,
      "description": "Refactor _compose_legacy_moviepy to consume the shared plan",
      "tasks": ["7.3"]
    },
    {
      "wave": 5,
      "description": "Verify exploration and preservation tests after the fix, in parallel",
      "tasks": ["7.4", "7.5", "7.6", "7.7"]
    },
    {
      "wave": 6,
      "description": "Final checkpoint - ensure all tests pass",
      "tasks": ["8"]
    }
  ]
}
```

## Notes

- Tasks 1–3 are standalone Bug Condition exploration tests (Properties 1–3) and
  MUST be written and run on the UNFIXED code first; each is expected to FAIL,
  which confirms the bug exists. Do not fix the code or tests when they fail.
- Tasks 4–6 are standalone Preservation tests (Properties 4–6) written using the
  observation-first methodology; each must PASS on the UNFIXED code to establish
  the baseline contract to protect.
- All freeze-timing assertions target the pure function `_calculate_segments`,
  making the tests fast and exhaustive without rendering video. Property-based
  testing (Hypothesis) is used for the universal "for all timelines" properties.
- The fix (task 7) consolidates timing into `_calculate_segments` as the single
  source of truth, adds the loading branch, anchors click freezes on the click
  frame via `clamp(ts, current_time, video_duration - 0.1)`, and refactors
  `_compose_legacy_moviepy` to consume the shared plan.
- The `is_loading` flag is backward-compatible (defaults to `False`), so existing
  `{timestamp, audio_path}` timelines preserve current structure.
- This spec is scoped to freeze-frame timing only and is unrelated to the
  `production-hardening` spec.
