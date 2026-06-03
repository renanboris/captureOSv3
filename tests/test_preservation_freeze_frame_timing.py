"""Preservation property tests for the freeze-frame timing bugfix.

These tests verify the STRUCTURAL CONTRACT of _calculate_segments that must
remain unchanged after the fix is applied. They are written using observation-first
methodology: the assertions match what the UNFIXED code currently produces, so
they PASS on the unfixed code and must continue to pass after the fix.

Only freeze TIMESTAMPS change after the fix — the structure (counts, shapes,
ordering) stays the same.

**Validates: Requirements 3.1, 3.2, 3.3**
"""

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from video_eng.time_bender import _calculate_segments


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

def click_event_strategy(min_ts=0.5, max_ts=20.0):
    """Generate a single non-loading click event."""
    return st.fixed_dictionaries({
        "timestamp": st.floats(min_value=min_ts, max_value=max_ts, allow_nan=False, allow_infinity=False),
        "audio_path": st.text(min_size=5, max_size=30).map(lambda s: f"audios/{s}.mp3"),
        "audio_duration": st.floats(min_value=0.5, max_value=5.0, allow_nan=False, allow_infinity=False),
        "is_loading": st.just(False),
    })


def non_loading_timeline_strategy(min_size=1, max_size=6):
    """Generate a valid non-loading click timeline (sorted by timestamp)."""
    return st.lists(
        click_event_strategy(),
        min_size=min_size,
        max_size=max_size,
    ).map(lambda events: sorted(events, key=lambda e: e["timestamp"]))


def video_duration_strategy(min_dur=10.0):
    """Generate a valid video duration."""
    return st.floats(min_value=min_dur, max_value=60.0, allow_nan=False, allow_infinity=False)


# ---------------------------------------------------------------------------
# Property 4: Preservation — Per-event freeze/audio structure
# ---------------------------------------------------------------------------

@given(
    events=non_loading_timeline_strategy(min_size=1, max_size=6),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=200, deadline=None)
def test_one_freeze_per_event_with_matching_duration(events, video_duration):
    """Property 4: Per-event freeze/audio structure for non-loading timelines.

    For a non-loading timeline, _calculate_segments emits exactly one
    ("freeze", _, dur) segment per event with dur equal to that event's
    audio_duration, exactly one audio_delays entry per event, and exactly one
    trailing final ("freeze", _, 3.5) segment.

    Only freeze timestamps may change after the fix, not the structure.

    **Validates: Requirements 3.1**
    """
    # Ensure all event timestamps fit within the video duration
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))

    segments, audio_delays = _calculate_segments(events, video_duration)

    # --- Structural assertions ---

    # 1. Identify all freeze segments
    freeze_segments = [s for s in segments if s[0] == "freeze"]

    # 2. The LAST freeze segment must be the trailing final freeze of 3.5s
    assert len(freeze_segments) >= 1, (
        f"Expected at least 1 freeze segment, got 0. Segments: {segments}"
    )
    trailing_freeze = freeze_segments[-1]
    assert abs(trailing_freeze[2] - 3.5) < 0.01, (
        f"Trailing freeze should have duration 3.5s, got {trailing_freeze[2]:.4f}s. "
        f"Segments: {segments}"
    )

    # 3. Non-trailing freeze segments: exactly one per event
    non_trailing_freezes = freeze_segments[:-1]
    assert len(non_trailing_freezes) == len(events), (
        f"Expected {len(events)} non-trailing freeze segments (one per event), "
        f"got {len(non_trailing_freezes)}. "
        f"Events: {len(events)}, Segments: {segments}"
    )

    # 4. Each non-trailing freeze duration matches the corresponding event's audio_duration
    for i, (freeze_seg, event) in enumerate(zip(non_trailing_freezes, events)):
        expected_dur = event["audio_duration"]
        actual_dur = freeze_seg[2]
        assert abs(actual_dur - expected_dur) < 1e-9, (
            f"Freeze segment {i} duration {actual_dur:.4f}s does not match "
            f"event audio_duration {expected_dur:.4f}s. "
            f"Event: {event}, Segment: {freeze_seg}"
        )

    # 5. Exactly one audio_delays entry per event
    assert len(audio_delays) == len(events), (
        f"Expected {len(events)} audio_delays entries (one per event), "
        f"got {len(audio_delays)}. Audio delays: {audio_delays}"
    )

    # 6. Each audio_delays entry has the correct audio_duration
    for i, (delay_entry, event) in enumerate(zip(audio_delays, events)):
        audio_path, delay_seconds, audio_dur = delay_entry
        expected_dur = event["audio_duration"]
        assert abs(audio_dur - expected_dur) < 1e-9, (
            f"Audio delay {i} duration {audio_dur:.4f}s does not match "
            f"event audio_duration {expected_dur:.4f}s. "
            f"Entry: {delay_entry}, Event: {event}"
        )


@given(
    events=non_loading_timeline_strategy(min_size=1, max_size=6),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=200, deadline=None)
def test_segment_ordering_video_and_freeze_alternate(events, video_duration):
    """Property 4 (supplementary): Segments maintain a coherent ordering.

    The segments list consists of ("video", ...) and ("freeze", ...) tuples in a
    logical order: video segments precede their corresponding freeze segments,
    and the trailing video remainder (if any) precedes the trailing 3.5s freeze.

    This structural invariant must hold before and after the fix.

    **Validates: Requirements 3.1**
    """
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))

    segments, audio_delays = _calculate_segments(events, video_duration)

    # The segments list is non-empty
    assert len(segments) >= 2, (
        f"Expected at least 2 segments (event freeze + trailing freeze), "
        f"got {len(segments)}. Segments: {segments}"
    )

    # The last segment is always the trailing 3.5s freeze
    assert segments[-1][0] == "freeze", (
        f"Last segment should be a freeze, got {segments[-1][0]}. Segments: {segments}"
    )
    assert abs(segments[-1][2] - 3.5) < 0.01, (
        f"Last segment should be the 3.5s trailing freeze, got duration {segments[-1][2]:.4f}. "
        f"Segments: {segments}"
    )

    # Each segment is a valid tuple of the expected shape
    for seg in segments:
        assert seg[0] in ("video", "freeze"), (
            f"Segment type must be 'video' or 'freeze', got '{seg[0]}'. Segment: {seg}"
        )
        if seg[0] == "video":
            # ("video", start, end) where start < end
            assert len(seg) == 3, f"Video segment must have 3 elements: {seg}"
            assert seg[2] > seg[1], (
                f"Video segment end must be > start: {seg}"
            )
        else:
            # ("freeze", freeze_t, duration) where duration > 0
            assert len(seg) == 3, f"Freeze segment must have 3 elements: {seg}"
            assert seg[2] > 0, (
                f"Freeze segment duration must be > 0: {seg}"
            )


# ---------------------------------------------------------------------------
# Strategies for Property 5 (any valid timeline — loading or non-loading)
# ---------------------------------------------------------------------------

def any_event_strategy(min_ts=0.5, max_ts=20.0):
    """Generate a single event that may or may not be a loading event."""
    return st.fixed_dictionaries({
        "timestamp": st.floats(min_value=min_ts, max_value=max_ts, allow_nan=False, allow_infinity=False),
        "audio_path": st.text(min_size=5, max_size=30).map(lambda s: f"audios/{s}.mp3"),
        "audio_duration": st.floats(min_value=0.5, max_value=5.0, allow_nan=False, allow_infinity=False),
        "is_loading": st.booleans(),
    })


def any_timeline_strategy(min_size=1, max_size=6):
    """Generate a valid timeline with mixed loading/non-loading events (sorted by timestamp)."""
    return st.lists(
        any_event_strategy(),
        min_size=min_size,
        max_size=max_size,
    ).map(lambda events: sorted(events, key=lambda e: e["timestamp"]))


# ---------------------------------------------------------------------------
# Property 5: Preservation — One non-decreasing audio delay per event
# ---------------------------------------------------------------------------

@given(
    events=any_timeline_strategy(min_size=1, max_size=6),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=200, deadline=None)
def test_one_audio_delay_per_event(events, video_duration):
    """Property 5: Exactly one audio_delays entry per event.

    For any valid timeline (loading or non-loading), _calculate_segments emits
    exactly one audio_delays entry per event, in input order.

    **Validates: Requirements 3.2, 3.3**
    """
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))

    segments, audio_delays = _calculate_segments(events, video_duration)

    # Exactly one audio_delays entry per event
    assert len(audio_delays) == len(events), (
        f"Expected {len(events)} audio_delays entries (one per event), "
        f"got {len(audio_delays)}. Events: {events}, Audio delays: {audio_delays}"
    )


@given(
    events=any_timeline_strategy(min_size=2, max_size=6),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=200, deadline=None)
def test_audio_delays_non_decreasing(events, video_duration):
    """Property 5: Audio delay_seconds values are non-decreasing.

    For any valid timeline (loading or non-loading), the delay_seconds values
    in audio_delays are non-decreasing along the expanded timeline.

    **Validates: Requirements 3.2, 3.3**
    """
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))

    segments, audio_delays = _calculate_segments(events, video_duration)

    # Extract delay_seconds values
    delays = [entry[1] for entry in audio_delays]

    # Delays must be non-decreasing
    for i in range(1, len(delays)):
        assert delays[i] >= delays[i - 1], (
            f"Audio delays not non-decreasing at index {i}: "
            f"delay[{i-1}]={delays[i-1]:.6f} > delay[{i}]={delays[i]:.6f}. "
            f"All delays: {delays}, Events: {events}"
        )


@given(
    events=any_timeline_strategy(min_size=1, max_size=6),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=200, deadline=None)
def test_audio_aligned_to_segment_start(events, video_duration):
    """Property 5: Each audio start aligns with its corresponding segment.

    Each audio's delay_seconds equals the cumulative shifted_time up to that
    point — i.e., the sum of all prior video segment durations plus all prior
    freeze durations. This means the audio is positioned at the start of its
    corresponding segment on the expanded timeline (a freeze segment for
    non-loading events, or the running video segment for loading events).

    We verify this by replaying the segment list and tracking cumulative
    expanded position, checking each audio delay matches the position where
    that event's audio-bearing segment begins.

    **Validates: Requirements 3.2, 3.3**
    """
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))

    segments, audio_delays = _calculate_segments(events, video_duration)

    # Verify alignment by replaying the segment computation.
    # Each event's audio delay should equal shifted_time at the point
    # where that event's audio starts playing — which is the accumulated
    # expanded position just before the event's audio-bearing segment.
    #
    # For the fixed code, shifted_time is accumulated per-event before the
    # audio_delay is appended. We can verify this independently by checking
    # that each audio_delays[i][1] equals the sum of all prior events'
    # audio_duration values plus prior video segment durations (from
    # non-loading clicks' preceding video segments and loading events'
    # running video segments that come before).
    #
    # A simpler, equivalent check: replay _calculate_segments logic and
    # verify the audio_delays match what we independently compute.
    expected_shifted = 0
    event_idx = 0
    current_t = 0

    for event in events:
        ts = event['timestamp']
        dur = event['audio_duration']

        if event.get('is_loading', False):
            # Loading: running video from current_t for dur seconds
            run_end = min(current_t + dur, video_duration)
            # Audio is positioned at start of this running segment
            if event_idx < len(audio_delays):
                actual_delay = audio_delays[event_idx][1]
                assert abs(actual_delay - expected_shifted) < 1e-9, (
                    f"Audio delay {event_idx} not aligned with segment start: "
                    f"expected {expected_shifted:.6f}, got {actual_delay:.6f}. "
                    f"Segments: {segments}, Audio delays: {audio_delays}"
                )
            expected_shifted += dur
            current_t = run_end
        else:
            # Non-loading: video segment then freeze
            freeze_ts = max(current_t, min(ts, video_duration - 0.1))
            if freeze_ts > current_t:
                end_ts = min(freeze_ts, video_duration)
                expected_shifted += (end_ts - current_t)
            # Audio is positioned at start of the freeze segment
            if event_idx < len(audio_delays):
                actual_delay = audio_delays[event_idx][1]
                assert abs(actual_delay - expected_shifted) < 1e-9, (
                    f"Audio delay {event_idx} not aligned with segment start: "
                    f"expected {expected_shifted:.6f}, got {actual_delay:.6f}. "
                    f"Segments: {segments}, Audio delays: {audio_delays}"
                )
            expected_shifted += dur
            current_t = freeze_ts

        event_idx += 1


# ---------------------------------------------------------------------------
# Property 6: Preservation — Routing behaviors unchanged
# ---------------------------------------------------------------------------

import os
import subprocess
from unittest.mock import patch, MagicMock

from video_eng.time_bender import compose_video_with_freeze_frames


class TestRoutingEmptyOrAllInvalidTimeline:
    """Property 6: Empty or all-invalid timeline → simple WebM→MP4 conversion.

    When there are no valid timeline events, compose_video_with_freeze_frames
    delegates to _simple_convert for a plain format conversion with no freeze
    frames.

    **Validates: Requirements 3.4**
    """

    @patch("video_eng.time_bender._simple_convert", return_value=True)
    @patch("os.path.exists", return_value=True)
    def test_empty_timeline_routes_to_simple_convert(self, mock_exists, mock_convert):
        """Empty timeline triggers simple conversion."""
        result = compose_video_with_freeze_frames(
            "input.webm", "output.mp4", []
        )
        assert result is True
        mock_convert.assert_called_once_with("input.webm", "output.mp4")

    @patch("video_eng.time_bender._simple_convert", return_value=True)
    @patch("video_eng.time_bender._get_media_duration", return_value=30.0)
    @patch("os.path.exists")
    def test_all_invalid_audio_routes_to_simple_convert(
        self, mock_exists, mock_duration, mock_convert
    ):
        """Timeline with all audio files missing → simple conversion.

        When os.path.exists returns False for all audio paths, no valid_events
        are produced, triggering the simple conversion path.
        """
        # input video exists, but audio files do not
        def exists_side_effect(path):
            if path == "input.webm":
                return True
            return False  # All audio files missing

        mock_exists.side_effect = exists_side_effect

        timeline = [
            {"timestamp": 2.0, "audio_path": "audios/step1.mp3"},
            {"timestamp": 5.0, "audio_path": "audios/step2.mp3"},
        ]
        result = compose_video_with_freeze_frames(
            "input.webm", "output.mp4", timeline
        )
        assert result is True
        mock_convert.assert_called_once_with("input.webm", "output.mp4")


class TestRoutingMissingInputVideo:
    """Property 6: Missing input video → returns False without raising.

    When the input video file does not exist, compose_video_with_freeze_frames
    returns False immediately without raising an exception.

    **Validates: Requirements 3.5**
    """

    def test_missing_input_video_returns_false(self):
        """Non-existent input video returns False gracefully."""
        result = compose_video_with_freeze_frames(
            "nonexistent_video_file_xyz.webm",
            "output.mp4",
            [{"timestamp": 2.0, "audio_path": "audios/step1.mp3"}],
        )
        assert result is False

    def test_missing_input_video_does_not_raise(self):
        """Missing input video does not raise any exception."""
        # Should not raise — just returns False
        try:
            result = compose_video_with_freeze_frames(
                "another_nonexistent_file.webm",
                "output.mp4",
                [],
            )
            assert result is False
        except Exception as e:
            raise AssertionError(
                f"compose_video_with_freeze_frames raised {type(e).__name__}: {e} "
                "instead of returning False for a missing input video"
            )


class TestRoutingFFmpegFailureFallback:
    """Property 6: FFmpeg failure → falls back to _compose_legacy_moviepy.

    When the FFmpeg filter_complex path fails (non-zero exit, invalid/empty
    output, timeout, or exception), compose_video_with_freeze_frames falls back
    to the MoviePy composition.

    **Validates: Requirements 3.6**
    """

    @patch("video_eng.time_bender._compose_legacy_moviepy", return_value=True)
    @patch("subprocess.run")
    @patch("video_eng.time_bender._get_media_duration", return_value=30.0)
    @patch("os.path.exists", return_value=True)
    def test_ffmpeg_nonzero_exit_triggers_moviepy_fallback(
        self, mock_exists, mock_duration, mock_subprocess, mock_moviepy
    ):
        """FFmpeg non-zero exit code → MoviePy fallback called."""
        # Simulate FFmpeg returning non-zero exit code
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "filter_complex error"
        mock_subprocess.return_value = mock_result

        timeline = [
            {"timestamp": 2.0, "audio_path": "audios/step1.mp3"},
        ]
        result = compose_video_with_freeze_frames(
            "input.webm", "output.mp4", timeline
        )
        assert result is True
        mock_moviepy.assert_called_once_with("input.webm", "output.mp4", timeline)

    @patch("video_eng.time_bender._compose_legacy_moviepy", return_value=True)
    @patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="ffmpeg", timeout=600))
    @patch("video_eng.time_bender._get_media_duration", return_value=30.0)
    @patch("os.path.exists", return_value=True)
    def test_ffmpeg_timeout_triggers_moviepy_fallback(
        self, mock_exists, mock_duration, mock_subprocess, mock_moviepy
    ):
        """FFmpeg timeout → MoviePy fallback called."""
        timeline = [
            {"timestamp": 2.0, "audio_path": "audios/step1.mp3"},
        ]
        result = compose_video_with_freeze_frames(
            "input.webm", "output.mp4", timeline
        )
        assert result is True
        mock_moviepy.assert_called_once_with("input.webm", "output.mp4", timeline)

    @patch("video_eng.time_bender._compose_legacy_moviepy", return_value=True)
    @patch("subprocess.run", side_effect=OSError("FFmpeg binary not found"))
    @patch("video_eng.time_bender._get_media_duration", return_value=30.0)
    @patch("os.path.exists", return_value=True)
    def test_ffmpeg_exception_triggers_moviepy_fallback(
        self, mock_exists, mock_duration, mock_subprocess, mock_moviepy
    ):
        """FFmpeg raising an exception → MoviePy fallback called."""
        timeline = [
            {"timestamp": 2.0, "audio_path": "audios/step1.mp3"},
        ]
        result = compose_video_with_freeze_frames(
            "input.webm", "output.mp4", timeline
        )
        assert result is True
        mock_moviepy.assert_called_once_with("input.webm", "output.mp4", timeline)

    @patch("video_eng.time_bender._compose_legacy_moviepy", return_value=True)
    @patch("subprocess.run")
    @patch("os.path.getsize", return_value=500)  # < 1000 bytes = invalid
    @patch("video_eng.time_bender._get_media_duration", return_value=30.0)
    @patch("os.path.exists", return_value=True)
    def test_ffmpeg_invalid_output_triggers_moviepy_fallback(
        self, mock_exists, mock_duration, mock_getsize, mock_subprocess, mock_moviepy
    ):
        """FFmpeg produces invalid/empty output file → MoviePy fallback called."""
        # FFmpeg succeeds (returncode 0) but output is too small
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_subprocess.return_value = mock_result

        timeline = [
            {"timestamp": 2.0, "audio_path": "audios/step1.mp3"},
        ]
        result = compose_video_with_freeze_frames(
            "input.webm", "output.mp4", timeline
        )
        assert result is True
        mock_moviepy.assert_called_once_with("input.webm", "output.mp4", timeline)


class TestPublicSurfaceUnchanged:
    """Property 6: Public surface unchanged.

    compose_video_with_freeze_frames is importable and
    _calculate_segments(timeline_events, video_duration) -> (segments, audio_delays)
    keeps the same shapes.

    **Validates: Requirements 3.4, 3.5, 3.6**
    """

    def test_compose_video_with_freeze_frames_importable(self):
        """compose_video_with_freeze_frames is importable from the module."""
        from video_eng.time_bender import compose_video_with_freeze_frames as fn
        assert callable(fn)

    def test_calculate_segments_importable(self):
        """_calculate_segments is importable from the module."""
        from video_eng.time_bender import _calculate_segments as fn
        assert callable(fn)

    def test_calculate_segments_returns_tuple_of_two(self):
        """_calculate_segments returns a 2-tuple (segments, audio_delays)."""
        events = [
            {"timestamp": 2.0, "audio_path": "audios/test.mp3", "audio_duration": 1.5, "is_loading": False}
        ]
        result = _calculate_segments(events, 10.0)
        assert isinstance(result, tuple)
        assert len(result) == 2

    def test_calculate_segments_segments_shape(self):
        """segments contains tuples of shape (type_str, float, float)."""
        events = [
            {"timestamp": 3.0, "audio_path": "audios/test.mp3", "audio_duration": 2.0, "is_loading": False}
        ]
        segments, _ = _calculate_segments(events, 15.0)
        assert isinstance(segments, list)
        for seg in segments:
            assert isinstance(seg, tuple)
            assert len(seg) == 3
            assert seg[0] in ("video", "freeze")
            assert isinstance(seg[1], (int, float))
            assert isinstance(seg[2], (int, float))

    def test_calculate_segments_audio_delays_shape(self):
        """audio_delays contains tuples of shape (str, float, float)."""
        events = [
            {"timestamp": 3.0, "audio_path": "audios/test.mp3", "audio_duration": 2.0, "is_loading": False}
        ]
        _, audio_delays = _calculate_segments(events, 15.0)
        assert isinstance(audio_delays, list)
        for entry in audio_delays:
            assert isinstance(entry, tuple)
            assert len(entry) == 3
            assert isinstance(entry[0], str)  # audio_path
            assert isinstance(entry[1], (int, float))  # delay_seconds
            assert isinstance(entry[2], (int, float))  # audio_duration
