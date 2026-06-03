# Bugfix Requirements Document

## Introduction

`video_eng/time_bender.py` composes the final tutorial video by inserting freeze
frames that pause the screen while a TTS narration ("micronarração") plays. The
freeze placement logic decides *which frame* to pause on and *when* to pause.

Two timing defects degrade comprehension:

1. **Freezing during loading transitions.** When the narration for a step is a
   "loading" micro-narration (describing a screen that is loading/animating in),
   the composer still inserts a freeze. The pause lands on a half-loaded screen,
   so the learner sees a frozen, incomplete UI while being told the screen is
   loading. For these steps the video should keep running so the loading
   animation plays underneath the narration.

2. **Mistimed pre-click freeze.** The freeze before a click is computed from a
   fixed `safe_offset = 0.2` (with a `0.1` fallback), i.e. it always freezes a
   fixed amount of time *before* the click timestamp. Because the cursor is
   still travelling toward its target during those milliseconds, the frozen
   frame frequently shows the mouse on the **wrong** button (subconsciously
   suggesting an incorrect target) or before it reaches the correct screen.
   Freezing a few milliseconds *after* the click instead loses the correct
   screen/button. The freeze must land on the exact frame where the cursor is
   on the correct target.

A related structural defect amplifies both bugs: the freeze-timing logic is
**duplicated** between the primary FFmpeg path (`_calculate_segments`) and the
MoviePy fallback (`_compose_legacy_moviepy`). The two copies use the same magic
offsets today but can drift, so the same input can yield different freeze
placement depending on which renderer runs. Any timing fix must apply
identically to both paths.

This bugfix is scoped to freeze-frame timing only. It is unrelated to the
separate `production-hardening` spec.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a timeline event's narration is a "loading" micro-narration THEN the system inserts a freeze frame and pauses the video on a partially-loaded screen for the duration of the narration.

1.2 WHEN a freeze frame is computed for a click event THEN the system places the freeze at a fixed offset (`safe_offset = 0.2s`) before the click timestamp, which can land on a frame where the cursor has not yet reached the correct target (showing the cursor on the wrong button or in transit).

1.3 WHEN the fixed offset would place the freeze at or after the click (a short gap between events or close to time zero) THEN the system falls back to another fixed offset (`ts - 0.1`) without verifying that the cursor is on the correct target in the chosen frame.

1.4 WHEN the same timeline and video are rendered THEN the system computes the freeze timing independently in two code paths (the FFmpeg `_calculate_segments` path and the MoviePy `_compose_legacy_moviepy` fallback), so the two paths can diverge and produce different freeze placement for identical input.

### Expected Behavior (Correct)

2.1 WHEN a timeline event's narration is a "loading" micro-narration THEN the system SHALL let the video keep running (play the loading animation) for the duration of the narration instead of freezing on a half-loaded screen.

2.2 WHEN a freeze frame is computed for a click event THEN the system SHALL place the freeze on a frame where the cursor is positioned on the correct target for that click, rather than at a fixed offset before the click.

2.3 WHEN the gap before a click is too short to place a correctly-targeted freeze THEN the system SHALL choose a deterministic frame that still shows the cursor on the correct target (e.g. the click frame itself) rather than freezing on a frame with the cursor off-target.

2.4 WHEN the same timeline and video are rendered THEN the system SHALL produce identical freeze placement whether the FFmpeg path or the MoviePy fallback performs the composition, using a single shared timing rule.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a timeline contains only normal (non-loading) click events THEN the system SHALL CONTINUE TO insert one freeze frame per event whose duration matches that event's TTS audio duration, plus a trailing final freeze frame (3.5s).

3.2 WHEN segments are computed for a valid non-loading timeline THEN the system SHALL CONTINUE TO produce exactly one audio delay per event, with audio delays in non-decreasing order along the expanded timeline.

3.3 WHEN each TTS audio is positioned THEN the system SHALL CONTINUE TO align the audio start with its freeze (or running) segment so the narration plays over the intended screen.

3.4 WHEN there are no valid timeline events THEN the system SHALL CONTINUE TO perform a simple WebM→MP4 conversion without freeze frames.

3.5 WHEN the input video is missing THEN the system SHALL CONTINUE TO return `False` without raising an exception.

3.6 WHEN the FFmpeg filter_complex path fails (non-zero exit, invalid output, timeout, or exception) THEN the system SHALL CONTINUE TO fall back to the MoviePy composition.
