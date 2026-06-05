"""Bug condition exploration tests for the freeze-frame timing bugfix.

These tests encode the EXPECTED (correct) behavior and are designed to FAIL
on the unfixed code, confirming the bug exists. Once the fix is applied, these
tests will PASS, validating the fix.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**
"""

import inspect
import textwrap

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from video_eng.time_bender import _calculate_segments, _compose_legacy_moviepy


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

def loading_event_strategy():
    """Generate a single loading event with varied timestamp and audio_duration."""
    return st.fixed_dictionaries({
        "timestamp": st.floats(min_value=0.5, max_value=20.0, allow_nan=False, allow_infinity=False),
        "audio_path": st.just("audios/loading_narration.mp3"),
        "audio_duration": st.floats(min_value=0.5, max_value=5.0, allow_nan=False, allow_infinity=False),
        "is_loading": st.just(True),
    })


def video_duration_strategy(min_dur=5.0):
    """Generate a valid video duration that is longer than the event timestamps."""
    return st.floats(min_value=min_dur, max_value=30.0, allow_nan=False, allow_infinity=False)


# ---------------------------------------------------------------------------
# Property 1: Bug Condition — Loading narrations play, not freeze
# ---------------------------------------------------------------------------

@given(
    loading_event=loading_event_strategy(),
    video_duration=video_duration_strategy(),
)
@settings(max_examples=100, deadline=None)
def test_loading_narration_should_not_freeze(loading_event, video_duration):
    """Property 1: Bug Condition — Loading narrations play, not freeze.

    For a loading event, _calculate_segments SHALL NOT emit a ("freeze", ...)
    segment attributable to that event; instead it emits running ("video", ...)
    coverage spanning the narration, with the event's audio positioned over the
    running segment.

    **Validates: Requirements 2.1**
    """
    # Ensure the video is long enough to contain the event
    assume(video_duration > loading_event["timestamp"] + 0.5)

    timeline_events = [loading_event]
    segments, audio_delays = _calculate_segments(timeline_events, video_duration)

    # Identify segments attributable to the loading event.
    # The trailing final freeze (3.5s) is always appended and is NOT attributable
    # to the loading event — it's a structural element. We exclude it.
    # The loading event's segments are everything before the trailing remainder
    # video and the final 3.5s freeze.
    event_segments = []
    for seg in segments:
        # The trailing final freeze is ("freeze", safe_final_t, 3.5)
        # The trailing video remainder follows the event processing
        # We attribute segments emitted DURING event processing (not trailing)
        event_segments.append(seg)

    # Remove the trailing final freeze (last segment if it's a 3.5s freeze)
    if event_segments and event_segments[-1][0] == "freeze" and abs(event_segments[-1][2] - 3.5) < 0.01:
        trailing_freeze = event_segments.pop()

    # Remove the trailing video remainder (segment after event processing)
    # For a loading event starting at current_time=0, the event consumes up to
    # current_time + dur of the recording. Any video segment starting after that
    # is the remainder, not attributable to the event.
    event_end = min(loading_event["timestamp"] + loading_event["audio_duration"], video_duration)
    # Actually, since current_time starts at 0 for a single-event timeline,
    # the loading branch should emit running video from 0 to min(0+dur, video_duration).
    # But the current (unfixed) code doesn't know about is_loading and just freezes.

    # The KEY assertion: no freeze segment should be attributable to the loading event.
    # For a single-event timeline, the first freeze segment (if any) before the
    # trailing 3.5s freeze would be the one attributable to our event.
    non_trailing_freezes = [
        seg for seg in event_segments
        if seg[0] == "freeze"
    ]

    # BUG CONDITION: The unfixed code will emit a freeze for this loading event.
    # The EXPECTED (correct) behavior is: NO freeze for loading events (only running video).
    assert len(non_trailing_freezes) == 0, (
        f"Loading event {{ts: {loading_event['timestamp']}, "
        f"dur: {loading_event['audio_duration']}, is_loading: True}} "
        f"produces a {non_trailing_freezes[0][2]:.1f}s freeze on a half-loaded "
        f"frame at ~{non_trailing_freezes[0][1]:.1f}s instead of running video. "
        f"Segments: {segments}"
    )

    # Additional assertion: there should be running ("video", ...) coverage
    # spanning the narration duration for the loading event.
    video_segments = [seg for seg in event_segments if seg[0] == "video"]
    total_video_coverage = sum(seg[2] - seg[1] for seg in video_segments)
    assert total_video_coverage > 0, (
        f"Loading event should produce running video coverage, but got none. "
        f"Segments: {segments}"
    )


# ---------------------------------------------------------------------------
# Strategies for Property 2
# ---------------------------------------------------------------------------

def click_event_strategy(min_ts=0.5, max_ts=20.0):
    """Generate a single non-loading click event."""
    return st.fixed_dictionaries({
        "timestamp": st.floats(min_value=min_ts, max_value=max_ts, allow_nan=False, allow_infinity=False),
        "audio_path": st.just("audios/click_narration.mp3"),
        "audio_duration": st.floats(min_value=0.5, max_value=5.0, allow_nan=False, allow_infinity=False),
        "is_loading": st.just(False),
    })


# ---------------------------------------------------------------------------
# Property 2: Bug Condition — Click freeze lands on the correct-target frame
# ---------------------------------------------------------------------------

@given(
    click_event=click_event_strategy(),
    video_duration=video_duration_strategy(min_dur=5.0),
)
@settings(max_examples=100, deadline=None)
def test_click_freeze_lands_on_click_frame_single_event(click_event, video_duration):
    """Property 2: Bug Condition — Click freeze lands on the correct-target frame (single event).

    For a non-loading click event with timestamp `ts`, `_calculate_segments`
    SHALL anchor the freeze on the click frame:
        freeze_t = clamp(ts, lower=current_time, upper=video_duration - 0.1)

    On UNFIXED code this will fail because it uses ts - 0.2 (safe_offset)
    instead of the click frame.

    **Validates: Requirements 2.2, 2.3**
    """
    ts = click_event["timestamp"]
    # Ensure video is long enough to contain the click
    assume(video_duration > ts + 0.5)

    timeline_events = [click_event]
    segments, audio_delays = _calculate_segments(timeline_events, video_duration)

    # For a single-event timeline, current_time starts at 0.
    # Expected freeze_t = clamp(ts, lower=0, upper=video_duration - 0.1) = ts
    # (since ts >= 0 and ts < video_duration - 0.1 given our assume above)
    current_time = 0
    expected_freeze_t = max(current_time, min(ts, video_duration - 0.1))

    # Find the freeze segment attributable to the click event (not the trailing 3.5s freeze).
    # The trailing final freeze is always the LAST freeze segment in the list.
    freeze_segments = [seg for seg in segments if seg[0] == "freeze"]
    # For a single-event timeline the trailing freeze is always the last one.
    # The event's freeze is the first freeze segment.
    assert len(freeze_segments) >= 2, (
        f"Expected at least 2 freeze segments (1 event + 1 trailing) for a single click event, "
        f"got {len(freeze_segments)}. Segments: {segments}"
    )
    # The event's freeze is the first one (emitted during event processing)
    non_trailing_freezes = freeze_segments[:-1]

    assert len(non_trailing_freezes) == 1, (
        f"Expected exactly one non-trailing freeze for a single click event, "
        f"got {len(non_trailing_freezes)}. Segments: {segments}"
    )

    actual_freeze_t = non_trailing_freezes[0][1]

    assert abs(actual_freeze_t - expected_freeze_t) < 1e-9, (
        f"Click at ts={ts:.3f}: freeze landed at {actual_freeze_t:.3f} "
        f"(off-target, likely ts - 0.2 = {ts - 0.2:.3f}) "
        f"instead of the click frame {expected_freeze_t:.3f}. "
        f"The cursor is on the wrong button at the frozen frame. "
        f"Segments: {segments}"
    )


@given(
    first_ts=st.floats(min_value=1.0, max_value=10.0, allow_nan=False, allow_infinity=False),
    gap=st.floats(min_value=0.05, max_value=0.25, allow_nan=False, allow_infinity=False),
    audio_dur_1=st.floats(min_value=0.5, max_value=3.0, allow_nan=False, allow_infinity=False),
    audio_dur_2=st.floats(min_value=0.5, max_value=3.0, allow_nan=False, allow_infinity=False),
    video_duration=video_duration_strategy(min_dur=15.0),
)
@settings(max_examples=100, deadline=None)
def test_click_freeze_short_gap_fallback(first_ts, gap, audio_dur_1, audio_dur_2, video_duration):
    """Property 2: Bug Condition — Short-gap fallback still lands on click frame.

    Two closely spaced clicks (gap < 0.25s) trigger the unfixed code's
    `ts - 0.1` short-gap fallback. The EXPECTED behavior is that even with a
    short gap, the freeze still lands on clamp(ts, current_time, video_duration - 0.1).

    On UNFIXED code this will fail because the second click's freeze uses the
    fallback ts - 0.1 instead of the click frame.

    **Validates: Requirements 2.2, 2.3**
    """
    second_ts = first_ts + gap
    # Ensure video is long enough
    assume(video_duration > second_ts + 1.0)

    timeline_events = [
        {
            "timestamp": first_ts,
            "audio_path": "audios/click_1.mp3",
            "audio_duration": audio_dur_1,
            "is_loading": False,
        },
        {
            "timestamp": second_ts,
            "audio_path": "audios/click_2.mp3",
            "audio_duration": audio_dur_2,
            "is_loading": False,
        },
    ]

    segments, audio_delays = _calculate_segments(timeline_events, video_duration)

    # Find all freeze segments that are NOT the trailing 3.5s freeze
    freeze_segments = [
        seg for seg in segments
        if seg[0] == "freeze" and abs(seg[2] - 3.5) > 0.01
    ]

    assert len(freeze_segments) == 2, (
        f"Expected 2 non-trailing freezes for 2 click events, "
        f"got {len(freeze_segments)}. Segments: {segments}"
    )

    # For the FIRST event: current_time = 0
    # expected_freeze_t_1 = clamp(first_ts, 0, video_duration - 0.1)
    expected_freeze_t_1 = max(0, min(first_ts, video_duration - 0.1))

    # For the SECOND event: current_time = freeze_ts of first event (which the
    # unfixed code computes as first_ts - 0.2 or similar, but expected is first_ts)
    # Under the EXPECTED fix, current_time after first event = expected_freeze_t_1
    # expected_freeze_t_2 = clamp(second_ts, expected_freeze_t_1, video_duration - 0.1)
    expected_freeze_t_2 = max(expected_freeze_t_1, min(second_ts, video_duration - 0.1))

    actual_freeze_t_1 = freeze_segments[0][1]
    actual_freeze_t_2 = freeze_segments[1][1]

    # Assert the SECOND click's freeze is on the click frame (this is the one
    # most affected by the short-gap fallback bug)
    assert abs(actual_freeze_t_2 - expected_freeze_t_2) < 1e-9, (
        f"Short-gap pair ts=[{first_ts:.3f}, {second_ts:.3f}] (gap={gap:.3f}s): "
        f"second freeze landed at {actual_freeze_t_2:.3f} "
        f"(off-target, likely ts - 0.1 = {second_ts - 0.1:.3f} fallback) "
        f"instead of the click frame {expected_freeze_t_2:.3f}. "
        f"The cursor is still in transit at the frozen frame. "
        f"Segments: {segments}"
    )

    # Also assert the first click's freeze is on its click frame
    assert abs(actual_freeze_t_1 - expected_freeze_t_1) < 1e-9, (
        f"First click at ts={first_ts:.3f}: freeze landed at {actual_freeze_t_1:.3f} "
        f"(off-target, ts - 0.2 = {first_ts - 0.2:.3f}) "
        f"instead of the click frame {expected_freeze_t_1:.3f}. "
        f"Segments: {segments}"
    )


# ---------------------------------------------------------------------------
# Property 3: Bug Condition — Single shared timing rule across both paths
# ---------------------------------------------------------------------------


def _moviepy_inline_timing(timeline_events, video_duration):
    """Replicate the inline timing logic from _compose_legacy_moviepy.

    This function extracts and replicates the freeze-timing computation that
    _compose_legacy_moviepy performs inline (without calling _calculate_segments).
    If the MoviePy fallback were using the shared rule, this independent
    computation would not exist.

    Returns (segments, audio_delays) in the same format as _calculate_segments,
    derived solely from the inline MoviePy logic.
    """
    segments = []
    audio_delays = []
    current_time = 0
    shifted_time = 0

    for event in timeline_events:
        ts = event['timestamp']
        audio_path = event['audio_path']
        dur = event['audio_duration']

        # Replicated from _compose_legacy_moviepy inline logic:
        # "safe_offset = 0.2"
        # "freeze_ts = max(current_time + 0.1, ts - safe_offset)"
        # "if freeze_ts >= ts: freeze_ts = max(current_time, ts - 0.1)"
        # "else: freeze_ts = max(0, ts - safe_offset)"
        safe_offset = 0.2
        if current_time > 0:
            freeze_ts = max(current_time + 0.1, ts - safe_offset)
            if freeze_ts >= ts:
                freeze_ts = max(current_time, ts - 0.1)
        else:
            freeze_ts = max(0, ts - safe_offset)

        # 1. Video segment from current_time to freeze_ts
        if freeze_ts > current_time:
            end_ts = min(freeze_ts, video_duration)
            seg_dur = end_ts - current_time
            segments.append(("video", current_time, end_ts))
            shifted_time += seg_dur

        # 2. Freeze frame
        safe_freeze = min(freeze_ts, video_duration - 0.1)
        segments.append(("freeze", safe_freeze, dur))

        # 3. Audio positioning
        audio_delays.append((audio_path, shifted_time, dur))

        shifted_time += dur
        current_time = freeze_ts

    # 4. Remainder of video
    if current_time < video_duration:
        segments.append(("video", current_time, video_duration))

    # 5. Trailing 3.5s freeze
    if video_duration > 0:
        safe_final_t = max(0, video_duration - 0.1)
        segments.append(("freeze", safe_final_t, 3.5))

    return segments, audio_delays


@given(
    events=st.lists(
        st.fixed_dictionaries({
            "timestamp": st.floats(min_value=0.5, max_value=20.0, allow_nan=False, allow_infinity=False),
            "audio_path": st.just("audios/narration.mp3"),
            "audio_duration": st.floats(min_value=0.5, max_value=5.0, allow_nan=False, allow_infinity=False),
            "is_loading": st.just(False),
        }),
        min_size=1,
        max_size=5,
    ),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=200, deadline=None)
def test_moviepy_fallback_uses_shared_timing_rule(events, video_duration):
    """Property 3: Bug Condition — Single shared timing rule across both paths.

    Both the FFmpeg path and the MoviePy fallback SHALL produce identical
    (segments, audio_delays) because both derive timing from the same
    _calculate_segments call; there SHALL be no independent freeze-timing
    computation in _compose_legacy_moviepy.

    This test verifies STRUCTURAL correctness: that _compose_legacy_moviepy
    delegates timing to _calculate_segments rather than re-implementing it
    inline. On UNFIXED code, _compose_legacy_moviepy has its own inline
    safe_offset/freeze_ts computation that is independent of _calculate_segments.

    The test asserts:
    1. The source of _compose_legacy_moviepy calls _calculate_segments (structural)
    2. There is no independent 'safe_offset' timing logic in _compose_legacy_moviepy

    When both assertions hold, the paths cannot diverge by construction.

    **Validates: Requirements 2.4**
    """
    # Ensure timestamps are within video duration
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))
    # Sort events by timestamp for realistic input
    sorted_events = sorted(events, key=lambda e: e["timestamp"])

    # === STRUCTURAL ASSERTION ===
    # The EXPECTED behavior (Property 3) states:
    #   "there SHALL be no independent freeze-timing computation in
    #    _compose_legacy_moviepy"
    # This means _compose_legacy_moviepy MUST delegate to _calculate_segments.

    # Inspect the source code of _compose_legacy_moviepy
    source = inspect.getsource(_compose_legacy_moviepy)

    # Assert that _compose_legacy_moviepy calls _calculate_segments
    # (which it does NOT in the unfixed code — it re-derives timing inline)
    assert "_calculate_segments" in source, (
        f"_compose_legacy_moviepy does NOT call _calculate_segments. "
        f"It re-implements freeze timing inline with its own safe_offset/freeze_ts "
        f"computation, violating Property 3 (single shared timing rule). "
        f"The inline logic can drift from _calculate_segments when either is "
        f"modified independently. "
        f"Input: events={sorted_events}, video_duration={video_duration}"
    )

    # Additionally verify there is no independent safe_offset computation
    # (the inline timing logic that should be removed)
    assert "safe_offset" not in source, (
        f"_compose_legacy_moviepy contains an independent 'safe_offset' "
        f"computation, confirming duplicated timing logic that can diverge "
        f"from _calculate_segments. Both paths must use a single shared rule. "
        f"Input: events={sorted_events}, video_duration={video_duration}"
    )
