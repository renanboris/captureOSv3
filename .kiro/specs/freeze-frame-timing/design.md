# Freeze-Frame Timing Bugfix Design

## Overview

`video_eng/time_bender.py` builds the final tutorial video by expanding the raw
screen recording: at each timeline event it inserts a **freeze frame** that
pauses the screen while a TTS micro-narration plays, then resumes the recording.
The placement of those freezes is wrong in two ways, and a structural defect
lets the two rendering paths drift apart.

This bugfix targets freeze-frame timing only. The fix has three parts:

1. **Stop freezing during "loading" micro-narrations.** For an event whose
   narration describes a screen that is loading/animating in, the composer must
   let the recording keep running (so the loading animation plays underneath the
   narration) instead of pausing on a half-loaded screen.

2. **Anchor the pre-click freeze on the correct target.** Instead of freezing a
   fixed `safe_offset = 0.2s` *before* the click timestamp — which lands on a
   frame where the cursor is still in transit toward the wrong button — the
   freeze must land on the frame where the cursor is on the correct target,
   which is the click frame itself.

3. **Use one shared timing rule for both renderers.** The freeze-timing logic is
   duplicated between the FFmpeg planner (`_calculate_segments`) and the MoviePy
   fallback (`_compose_legacy_moviepy`). The fix consolidates the rule into a
   single function (`_calculate_segments`) that the MoviePy fallback also
   consumes, so identical input yields identical freeze placement regardless of
   which renderer runs.

The strategy follows the bug-condition methodology: we first surface
counterexamples that demonstrate the bug on the unfixed code (exploratory
checking), then verify the fix is correct for all buggy inputs (fix checking)
and that the non-buggy contract behaviors are unchanged (preservation checking).

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — an event that is
  either a *loading* micro-narration (which is incorrectly frozen) or a *click*
  micro-narration whose freeze is anchored at a fixed offset before the click
  instead of on the click frame.
- **Property (P)**: The desired behavior for a buggy event — loading events let
  the recording keep running (no freeze), and click events freeze on the click
  frame where the cursor is on the correct target.
- **Preservation**: The structural contract of the composer that must remain
  unchanged: one freeze + one audio delay per non-loading event, non-decreasing
  audio delays, the trailing 3.5s final freeze, the no-events / missing-input /
  FFmpeg-fallback behaviors, and the public `_calculate_segments` /
  `compose_video_with_freeze_frames` surface.
- **`_calculate_segments`**: The function in `video_eng/time_bender.py` that maps
  `(timeline_events, video_duration)` to `(segments, audio_delays)`. After this
  fix it is the **single source of truth** for freeze timing.
- **`_compose_legacy_moviepy`**: The MoviePy fallback in
  `video_eng/time_bender.py` used when the FFmpeg `filter_complex` path fails. It
  currently re-derives freeze timing inline; the fix makes it call
  `_calculate_segments`.
- **`segments`**: Ordered list of `("video", start, end)` and
  `("freeze", freeze_t, duration)` tuples describing the expanded timeline.
- **`audio_delays`**: List of `(audio_path, delay_seconds, audio_duration)`
  tuples giving each narration's start position on the expanded timeline.
- **`is_loading`**: A per-event boolean signalling that the event's
  micro-narration is a loading narration. Absent/false means a normal click
  event (the default, preserving existing input shape).
- **Click frame**: The recording timestamp `ts` at which the click occurred —
  the frame on which the cursor is on the correct target.
- **`FRAME_DUR`**: One frame's duration (`1/FPS`, FPS = 30).

## Bug Details

### Bug Condition

The bug manifests for two kinds of timeline events. A **loading** event is
frozen when it should keep playing. A **click** event is frozen on a frame
chosen by a fixed offset (`safe_offset = 0.2s`, fallback `ts - 0.1s`) rather than
on the click frame, so the cursor is on the wrong button or still in transit.
Because the timing is computed independently in `_calculate_segments` and in
`_compose_legacy_moviepy`, the same input can also produce different placement
between the two paths.

**Formal Specification:**
```
FUNCTION isBugCondition(event, current_time, video_duration)
  INPUT:  event with { timestamp: ts, audio_duration: dur, is_loading: bool }
          current_time   (recording time consumed so far)
          video_duration
  OUTPUT: boolean   (true => the current/unfixed code mishandles this event)

  IF event.is_loading THEN
    // Defect 1: current code emits a freeze for loading narrations.
    RETURN True
  ELSE
    // Defect 2: current code freezes at a fixed offset before the click,
    // not on the click frame where the cursor is on the correct target.
    chosen := currentUnfixedFreezeFrame(ts, current_time)   // ~ ts - 0.2 / ts - 0.1
    RETURN chosen != clamp(ts, current_time, video_duration - 0.1)
  END IF
END FUNCTION
```

A timeline triggers the bug if `isBugCondition` holds for any of its events, or
if the FFmpeg and MoviePy paths disagree on the resulting `(segments,
audio_delays)` for the same input.

### Examples

- **Loading narration frozen (Defect 1).** Event `{ts: 6.0, dur: 2.5,
  is_loading: true}` over a screen that animates in from 6.0s–8.0s.
  *Expected:* recording keeps running 6.0s onward while the narration plays.
  *Actual:* a 2.5s freeze on the half-loaded frame at ~5.8s.

- **Cursor in transit (Defect 2).** Click at `ts = 4.0` where the cursor reaches
  the correct button at 4.0s, having passed over a different button at ~3.8s.
  *Expected:* freeze on the 4.0s frame (cursor on correct target).
  *Actual:* freeze at `4.0 - 0.2 = 3.8s`, cursor on the wrong button.

- **Short gap fallback (Defect 2, clause 1.3).** Two clicks at `ts = 3.0` and
  `ts = 3.15`. For the second, `safe_offset` would land at/after the previous
  freeze, so the code falls back to `ts - 0.1 = 3.05s` without checking the
  cursor is on target.
  *Expected:* a deterministic correct-target frame (the 3.15s click frame).
  *Actual:* `3.05s`, cursor still in transit.

- **Path divergence (Defect 3 / clause 1.4).** Identical `(timeline, video)`
  rendered by FFmpeg vs MoviePy can yield different freeze placement because each
  path computes timing on its own.
  *Expected:* identical `(segments, audio_delays)` from a single shared rule.

- **Edge — non-loading-only timeline.** A timeline of plain clicks must still
  produce exactly one freeze per event (duration = that event's audio) plus the
  trailing 3.5s freeze; only the freeze *time* changes from `ts - offset` to the
  click frame.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- For a timeline of normal (non-loading) click events: exactly **one freeze per
  event**, each freeze's duration equal to that event's TTS audio duration, plus
  one **trailing final freeze of 3.5s** (clause 3.1).
- Exactly **one audio delay per event**, with audio delays in **non-decreasing**
  order along the expanded timeline (clause 3.2).
- Each TTS audio's start **aligned with its corresponding segment** so the
  narration plays over the intended screen (clause 3.3).
- With **no valid timeline events**, a plain WebM→MP4 conversion with no freeze
  frames (clause 3.4).
- With a **missing input video**, return `False` without raising (clause 3.5).
- When the FFmpeg `filter_complex` path fails (non-zero exit, invalid/empty
  output, timeout, or exception), **fall back to MoviePy** (clause 3.6).
- The public surface — module-level `compose_video_with_freeze_frames` and the
  `_calculate_segments(timeline_events, video_duration) -> (segments,
  audio_delays)` contract — remains importable with the same shapes.

**Scope:**
All inputs that do not involve the corrected freeze timing must be completely
unaffected. This includes:
- Empty / all-invalid timelines (simple-convert path).
- Missing input video (early `False`).
- FFmpeg-failure fallback selection.
- The structure (counts, ordering, segment/tuple shapes) of `segments` and
  `audio_delays` — only the freeze *timestamps*, and the freeze-vs-running
  decision for loading events, change.

**Note:** The corrected behavior for buggy inputs is defined in the Correctness
Properties section (Properties 1–3). This section enumerates what must NOT
change.

## Hypothesized Root Cause

Based on the bug description and the code in `video_eng/time_bender.py`, the most
likely causes are:

1. **Unconditional freeze regardless of narration kind.** Both paths always
   append a `("freeze", ...)` segment per event. There is no notion of a
   "loading" narration, so loading steps are paused on a partial screen instead
   of playing through. The event dict (`{timestamp, audio_path}`) carries no
   signal to distinguish loading from click narrations.

2. **Fixed pre-click offset anchored on the wrong frame.** The rule
   `freeze_ts = max(current_time + 0.1, ts - safe_offset)` (with `safe_offset =
   0.2`) deliberately steps back from the click to "avoid catching the click
   itself." During that step-back window the cursor is still travelling, so the
   frozen frame shows the wrong button / pre-arrival screen. The intent (avoid a
   visible click animation) is achieved at the cost of the pedagogically
   important "cursor on correct target" frame.

3. **Brittle short-gap fallback.** When the gap is too small, the code falls back
   to `ts - 0.1` with no guarantee the cursor is on target — it just picks
   another fixed offset.

4. **Duplicated timing logic across renderers.** `_calculate_segments` and the
   inline loop in `_compose_legacy_moviepy` independently implement the same
   offsets. Any change to one can silently diverge from the other, so identical
   input can produce different freeze placement depending on which renderer runs.

## Correctness Properties

Property 1: Bug Condition — Loading narrations play, not freeze

_For any_ timeline event where `is_loading` is true (a buggy input under the
current code), the fixed `_calculate_segments` SHALL NOT emit a `("freeze", ...)`
segment for that event; instead it SHALL keep the recording running across the
narration (emit running `("video", ...)` coverage) and position that event's
audio over the running segment, so the loading animation plays underneath the
narration.

**Validates: Requirements 2.1**

Property 2: Bug Condition — Click freeze lands on the correct-target frame

_For any_ non-loading click event with timestamp `ts`, the fixed
`_calculate_segments` SHALL anchor that event's freeze on the click frame,
i.e. `freeze_t = clamp(ts, lower = current_time, upper = video_duration - 0.1)`,
rather than at a fixed offset before `ts`. When the gap before the click is too
short to play any preceding video, the chosen frame SHALL still be this
deterministic click-frame anchor (the frame where the cursor is on the correct
target), never an off-target pre-click offset.

**Validates: Requirements 2.2, 2.3**

Property 3: Bug Condition — Single shared timing rule across both paths

_For any_ valid `(timeline_events, video_duration)`, the FFmpeg path and the
MoviePy fallback SHALL produce identical `(segments, audio_delays)` because both
derive timing from the same `_calculate_segments` call; there SHALL be no
independent freeze-timing computation in `_compose_legacy_moviepy`.

**Validates: Requirements 2.4**

Property 4: Preservation — Per-event freeze/audio structure for non-loading timelines

_For any_ timeline of valid non-loading events, the fixed `_calculate_segments`
SHALL produce exactly one `("freeze", _, dur)` segment per event with `dur` equal
to that event's `audio_duration`, exactly one entry in `audio_delays` per event,
and exactly one trailing final `("freeze", _, 3.5)` segment — the same counts and
shapes as the original function (only the freeze timestamps differ).

**Validates: Requirements 3.1**

Property 5: Preservation — One non-decreasing audio delay per event

_For any_ valid timeline (loading or non-loading), the fixed `_calculate_segments`
SHALL emit exactly one `audio_delays` entry per event, in input order, with
`delay_seconds` values that are non-decreasing along the expanded timeline, and
each audio aligned to the start of its corresponding segment — preserving the
original audio-positioning contract.

**Validates: Requirements 3.2, 3.3**

Property 6: Preservation — Routing behaviors unchanged

_For any_ input where the freeze-timing rule is not exercised, the fixed
`compose_video_with_freeze_frames` SHALL behave exactly as the original: an empty
or all-invalid timeline performs a simple WebM→MP4 conversion with no freeze
frames; a missing input video returns `False` without raising; and an FFmpeg
`filter_complex` failure (non-zero exit, invalid/empty output, timeout, or
exception) falls back to the MoviePy composition.

**Validates: Requirements 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

**File**: `video_eng/time_bender.py`

The fix centralizes timing in `_calculate_segments`, corrects the freeze anchor,
adds the loading branch, and refactors the MoviePy fallback to consume the shared
plan.

1. **Thread the `is_loading` signal into events (backward-compatible).**
   - In `compose_video_with_freeze_frames`, when building `valid_events`, copy an
     optional `is_loading` flag from each incoming timeline event, defaulting to
     `False` when absent: `"is_loading": bool(event.get("is_loading", False))`.
   - This keeps the existing `{timestamp, audio_path}` input valid (treated as
     non-loading), so timelines that never set the flag preserve current
     structure. The caller (e.g. `api/rerender_pipeline.py`) is responsible for
     classifying loading micro-narrations and setting the flag; `time_bender`
     only consumes it.

2. **Make `_calculate_segments` the single shared timing rule** implementing the
   corrected per-event logic:

```
FUNCTION _calculate_segments(timeline_events, video_duration)
  segments      := []
  audio_delays  := []
  current_time  := 0      // recording time consumed
  shifted_time  := 0      // position on the expanded (output) timeline

  FOR EACH event IN timeline_events DO
    ts        := event.timestamp
    dur       := event.audio_duration
    audio     := event.audio_path

    IF event.is_loading THEN
      // Property 1: keep the recording running; no freeze.
      run_end := min(current_time + dur, video_duration)
      IF run_end > current_time THEN
        segments.append(("video", current_time, run_end))
      END IF
      // If the recording ends before the narration, hold the last frame
      // so the narration is fully covered and the timeline stays consistent.
      remainder := dur - (run_end - current_time)
      IF remainder > 0 THEN
        hold_t := max(0, video_duration - 0.1)
        segments.append(("freeze", hold_t, remainder))
      END IF
      audio_delays.append((audio, shifted_time, dur))
      shifted_time := shifted_time + dur
      current_time := run_end
    ELSE
      // Property 2: freeze on the click frame (cursor on correct target).
      freeze_ts := clamp(ts, lower = current_time, upper = video_duration - 0.1)
      IF freeze_ts > current_time THEN
        end_ts := min(freeze_ts, video_duration)
        segments.append(("video", current_time, end_ts))
        shifted_time := shifted_time + (end_ts - current_time)
      END IF
      segments.append(("freeze", freeze_ts, dur))
      audio_delays.append((audio, shifted_time, dur))
      shifted_time := shifted_time + dur
      current_time := freeze_ts
    END IF
  END FOR

  // Preserved: remainder of the recording after the last event.
  IF current_time < video_duration THEN
    segments.append(("video", current_time, video_duration))
  END IF

  // Preserved: trailing 3.5s final freeze.
  IF video_duration > 0 THEN
    safe_final_t := max(0, video_duration - 0.1)
    segments.append(("freeze", safe_final_t, 3.5))
  END IF

  RETURN (segments, audio_delays)
END FUNCTION
```

   Notes:
   - `clamp(ts, current_time, video_duration - 0.1)` removes the
     `safe_offset = 0.2` / `ts - 0.1` magic offsets entirely and anchors on the
     click frame. The `>= current_time` lower bound preserves the existing
     anti-flicker guarantee (never seek backwards). The `video_duration - 0.1`
     upper bound preserves the existing tail clamp.
   - For non-loading-only timelines the emitted counts/shapes are identical to
     today (one freeze per event + final freeze); only the freeze timestamps move
     from `ts - offset` to the click frame (Property 4).

3. **Refactor `_compose_legacy_moviepy` to consume the shared plan.**
   - Remove the inline `safe_offset` / `freeze_ts` block and the inline
     freeze/audio loop.
   - Build `valid_events` exactly as the FFmpeg path does: skip missing audio
     files, compute each `audio_duration` (via `AudioFileClip(...).duration` or
     `_get_media_duration`), and carry `is_loading`.
   - Call `segments, audio_delays = _calculate_segments(valid_events,
     video.duration)`.
   - Render from the shared plan: map each `("video", start, end)` to
     `video.subclipped(start, end)`, each `("freeze", t, d)` to
     `video.to_ImageClip(t=t).with_duration(d)`, concatenate, then place each
     audio with `AudioFileClip(path).with_start(delay)` from `audio_delays`.
   - This guarantees the FFmpeg and MoviePy outputs derive from the same
     `(segments, audio_delays)` (Property 3) and removes the duplication called
     out in clause 1.4.

4. **No change to `_build_filter_complex`, `_simple_convert`, or the
   FFmpeg-failure fallback wiring** — these are preserved behaviors (Property 6).

## Testing Strategy

### Validation Approach

Two phases. First, surface counterexamples that demonstrate the bug on the
**unfixed** code (exploratory checking) to confirm the root cause. Then verify
the fix is correct for all buggy inputs (fix checking) and that the structural
contract is unchanged (preservation checking). Property-based tests target
`_calculate_segments` directly because it is a pure function of
`(timeline_events, video_duration)`, which makes the timing rule cheaply and
exhaustively testable without rendering video.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing
the fix, and confirm or refute the root-cause analysis. If refuted, re-hypothesize.

**Test Plan**: Call `_calculate_segments` on crafted timelines and inspect the
returned `segments`/`audio_delays`. Run these against the UNFIXED code to observe
the wrong freeze placement and the missing loading branch.

**Test Cases**:
1. **Loading freeze**: a `{is_loading: true}` event yields a `("freeze", ...)`
   segment instead of a running `("video", ...)` segment (will fail on unfixed
   code — unfixed code has no `is_loading` concept and always freezes).
2. **Off-target click freeze**: a click at `ts = 4.0` yields `freeze_t ≈ 3.8`
   (`ts - 0.2`) rather than `4.0` (will fail on unfixed code).
3. **Short-gap fallback**: closely spaced clicks yield the `ts - 0.1` fallback
   frame rather than the click frame (will fail on unfixed code).
4. **Path divergence**: compare the timing the MoviePy fallback computes inline
   against `_calculate_segments` for the same input and show they can differ
   (will fail / diverge on unfixed code).

**Expected Counterexamples**:
- A freeze segment present for a loading event.
- `freeze_t` offset before `ts` for click events.
- Differing freeze placement between the FFmpeg and MoviePy computations.
- Likely causes: unconditional freeze emission, fixed `safe_offset`, duplicated
  timing logic.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed
function produces the expected behavior (loading → running, click → click-frame
freeze).

**Pseudocode:**
```
FOR ALL (event, current_time, video_duration) WHERE isBugCondition(event, current_time, video_duration) DO
  (segments, audio_delays) := _calculate_segments_fixed(timelineWith(event), video_duration)
  IF event.is_loading THEN
    ASSERT no ("freeze", ...) segment is attributable to event
    ASSERT running ("video", ...) coverage spans the narration
  ELSE
    ASSERT event's freeze segment time == clamp(event.ts, current_time, video_duration - 0.1)
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold — and
for the structural contract that must hold regardless — the fixed function
matches the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT _calculate_segments_original(input) == _calculate_segments_fixed(input)
END FOR

// And structural invariants that must hold for ALL valid inputs:
FOR ALL valid timeline DO
  ASSERT one audio_delay per event AND delays non-decreasing
  ASSERT non-loading timelines -> one freeze per event + one trailing 3.5s freeze
END FOR
```

**Testing Approach**: Property-based testing (Hypothesis — already used in this
repo) is recommended for preservation because it generates many timelines across
the input domain, catches edge cases manual tests miss, and gives strong
assurance that the structural contract is unchanged for all non-buggy inputs.

**Test Plan**: Observe the original behavior for routing and structure (empty
timeline, missing input, FFmpeg-failure fallback, per-event counts/ordering) on
the UNFIXED code, then encode those observations as tests that must keep passing
after the fix.

**Test Cases**:
1. **Per-event structure**: Observe one freeze + one audio delay per event plus a
   trailing 3.5s freeze for non-loading timelines on unfixed code; assert it
   still holds after the fix.
2. **Audio-delay ordering**: Observe non-decreasing `audio_delays` on unfixed
   code; assert preserved after the fix.
3. **Routing**: Observe simple-convert for empty/all-invalid timelines, `False`
   for missing input, and MoviePy fallback on FFmpeg failure; assert preserved.

### Unit Tests

- `_calculate_segments`: click event freezes on the click frame
  (`clamp(ts, current_time, video_duration - 0.1)`).
- `_calculate_segments`: loading event emits running video coverage and no
  freeze for that event.
- Edge cases: short gap between clicks, event near `video_duration`, loading
  event whose narration outlasts the remaining recording (hold-last-frame tail),
  and `current_time == 0` first event.
- Routing: missing input returns `False`; empty/all-invalid timeline triggers
  simple convert.

### Property-Based Tests

- Generate random valid timelines (mixed click/loading events, varied
  timestamps and audio durations) and assert: one audio delay per event, delays
  non-decreasing, click freezes at the click frame, loading events produce no
  freeze (Properties 1, 2, 5).
- Generate random non-loading timelines and assert exactly one freeze per event
  with matching duration plus the trailing 3.5s freeze (Property 4).
- Generate random inputs and assert the MoviePy-path plan equals the FFmpeg-path
  plan because both call `_calculate_segments` (Property 3).

### Integration Tests

- End-to-end compose over a short fixture recording with a mixed timeline;
  confirm freezes occur on click frames and loading steps play through.
- Force the FFmpeg path to fail and confirm the MoviePy fallback renders from the
  same `(segments, audio_delays)` with identical freeze placement.
- Confirm audio narrations align with their intended segments in the rendered
  output (spot-check delays against `audio_delays`).
