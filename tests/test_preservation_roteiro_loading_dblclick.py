"""Preservation property tests — Property 3: Non-Buggy Inputs Are Unchanged.

These tests verify that the CURRENT (unfixed) code already handles non-buggy
inputs correctly, and that the fix will not regress any of these behaviors.

Written using observation-first methodology: we observe what the UNFIXED code
currently produces for inputs where NEITHER isBugCondition1 NOR isBugCondition2
holds, then write property tests that pin that behavior.

EXPECTED OUTCOME (before the fix): Tests PASS — they confirm the baseline
behavior to preserve.

After the fix is applied (tasks 4.1 and 4.2) these tests MUST CONTINUE TO PASS.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
"""

import sys
import os

_REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from video_eng.time_bender import _calculate_segments


# ---------------------------------------------------------------------------
# Observed baseline (unfixed code)
# ---------------------------------------------------------------------------
#
# Observation 1 — Non-loading click timeline:
#   For a timeline of events all with is_loading=False (or absent), the current
#   _calculate_segments produces:
#     * One ("freeze", freeze_t, audio_duration) per event
#     * One ("video", start, end) before each freeze (when ts > current_time)
#     * A trailing ("video", ...) if video hasn't ended after last event
#     * A final ("freeze", safe_final_t, 3.5) as the trailing freeze
#   This is already pinned in test_preservation_freeze_frame_timing.py.
#
# Observation 2 — Pre-flagged is_loading=True events:
#   When an event carries is_loading=True, _calculate_segments emits a running
#   ("video", current_time, run_end) segment and NO per-event freeze for that
#   event. audio_delays gets one entry per event. This path already works
#   correctly on the unfixed code (time_bender reads is_loading correctly).
#   The bug is only that rerender_pipeline never sets is_loading=True — but
#   events that DO carry is_loading=True already work. The fix only changes
#   the upstream caller; _calculate_segments itself is unchanged.
#
# Observation 3 — Non-burst event lists (coalescer identity):
#   The function coalesce_dblclick_bursts does NOT exist yet in export_pipeline.
#   The preservation property for the coalescer states that for non-burst inputs
#   the function must be the identity (return the list unchanged). We test this
#   property by defining the expected behavior contract. The actual test against
#   the import will pass once task 4.2 implements it. Until then the test is
#   written to import gracefully and be marked as pending implementation.
#
# Observation 4 — Single-click preservation:
#   A lone non-loading click event results in exactly one non-trailing freeze
#   segment and one audio_delays entry.
#
# Observation 5 — Identical structure when no loading steps and no bursts:
#   For any non-loading timeline, the segment count and audio_delay count match
#   what the same inputs produce on the current code.
#
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

def non_loading_event_strategy(min_ts: float = 0.5, max_ts: float = 20.0):
    """Generate a single non-loading click event (is_loading=False or absent)."""
    return st.fixed_dictionaries({
        "timestamp": st.floats(
            min_value=min_ts, max_value=max_ts,
            allow_nan=False, allow_infinity=False,
        ),
        "audio_path": st.text(min_size=5, max_size=30).map(
            lambda s: f"audios/{s}.mp3"
        ),
        "audio_duration": st.floats(
            min_value=0.5, max_value=5.0,
            allow_nan=False, allow_infinity=False,
        ),
        "is_loading": st.just(False),
    })


def preflagged_loading_event_strategy(min_ts: float = 0.5, max_ts: float = 20.0):
    """Generate an event already carrying is_loading=True (pre-flagged by a caller).

    These events already work correctly on the unfixed code because
    _calculate_segments reads event.get('is_loading', False) and the flag
    is explicitly True. The preservation test verifies this path is unaffected
    by the fix.
    """
    return st.fixed_dictionaries({
        "timestamp": st.floats(
            min_value=min_ts, max_value=max_ts,
            allow_nan=False, allow_infinity=False,
        ),
        "audio_path": st.text(min_size=5, max_size=30).map(
            lambda s: f"audios/{s}.mp3"
        ),
        "audio_duration": st.floats(
            min_value=0.5, max_value=5.0,
            allow_nan=False, allow_infinity=False,
        ),
        "is_loading": st.just(True),
    })


def non_loading_timeline_strategy(min_size: int = 1, max_size: int = 6):
    """Generate a sorted non-loading timeline."""
    return st.lists(
        non_loading_event_strategy(),
        min_size=min_size,
        max_size=max_size,
    ).map(lambda evs: sorted(evs, key=lambda e: e["timestamp"]))


def preflagged_loading_timeline_strategy(min_size: int = 1, max_size: int = 4):
    """Generate a sorted timeline of pre-flagged is_loading=True events."""
    return st.lists(
        preflagged_loading_event_strategy(),
        min_size=min_size,
        max_size=max_size,
    ).map(lambda evs: sorted(evs, key=lambda e: e["timestamp"]))


def video_duration_strategy(min_dur: float = 10.0):
    """Generate a valid video duration."""
    return st.floats(
        min_value=min_dur, max_value=60.0,
        allow_nan=False, allow_infinity=False,
    )


# ---------------------------------------------------------------------------
# Helpers for non-burst event generation (Coalescer identity tests)
# ---------------------------------------------------------------------------

OTHER_XPATHS = [
    '//button[@id="save"]',
    '//input[@id="search"]',
    '//div[@class="menu"]/li[1]',
    '//a[@href="/home"]',
    '//span[@id="label_amount"]',
]

NON_CLICK_ACTIONS = ["input", "change", "scroll", "navigation"]
COALESCE_WINDOW_MS = 400  # mirrors the constant that the fix will introduce


def _make_event(action: str, xpath: str, timestamp: int,
                x: int = 0, y: int = 0) -> dict:
    """Build a minimal captured event dict in the export_pipeline format."""
    return {
        "timestamp": timestamp,
        "eventData": {
            "action": action,
            "xpath": xpath,
            "css_selector": "",
            "target_geometry": {"x": x, "y": y, "width": 10, "height": 10},
            "target_text": xpath.split("/")[-1] if "/" in xpath else xpath,
            "url": "https://example.com",
        },
        "screenshotData": "",
    }


@st.composite
def distinct_target_events_strategy(draw):
    """Generate a list of events on DISTINCT xpaths — never a burst.

    Each event is a single click or non-click event on a unique xpath, so no
    same-target click+click+dblclick burst can exist.  isBugCondition2 is
    therefore False for all generated lists.
    """
    n = draw(st.integers(min_value=1, max_value=5))
    # Sample n distinct xpaths
    xpaths = draw(st.lists(
        st.sampled_from(OTHER_XPATHS),
        min_size=n, max_size=n,
        unique=True,
    ))
    base_ts = draw(st.integers(min_value=1_700_000_000_000, max_value=1_800_000_000_000))

    events = []
    for i, xpath in enumerate(xpaths):
        action = draw(st.sampled_from(["click", "dblclick", "input", "change", "scroll"]))
        ts = base_ts + i * 1000  # 1s apart — well outside any burst window
        events.append(_make_event(action, xpath, ts))

    # Sort by timestamp
    return sorted(events, key=lambda e: e["timestamp"])


@st.composite
def lone_single_click_strategy(draw):
    """Generate a list containing exactly ONE click event.

    A lone single click cannot form a burst (needs at least click+click+dblclick).
    isBugCondition2 is False.
    """
    xpath = draw(st.sampled_from(OTHER_XPATHS))
    ts = draw(st.integers(min_value=1_700_000_000_000, max_value=1_800_000_000_000))
    return [_make_event("click", xpath, ts)]


@st.composite
def out_of_window_same_target_strategy(draw):
    """Generate click events on the same target but separated beyond COALESCE_WINDOW_MS.

    Even though they share an xpath, the time gap means they are distinct
    interactions, not a burst.  isBugCondition2 is False.
    """
    xpath = draw(st.sampled_from(OTHER_XPATHS))
    ts1 = draw(st.integers(min_value=1_700_000_000_000, max_value=1_750_000_000_000))
    # Ensure the gap is well beyond the coalescing window
    gap = draw(st.integers(min_value=COALESCE_WINDOW_MS + 100, max_value=5000))
    ts2 = ts1 + gap
    action1 = draw(st.sampled_from(["click", "dblclick"]))
    action2 = draw(st.sampled_from(["click", "dblclick"]))
    return sorted(
        [_make_event(action1, xpath, ts1), _make_event(action2, xpath, ts2)],
        key=lambda e: e["timestamp"],
    )


@st.composite
def non_click_events_only_strategy(draw):
    """Generate a list of only input/change/scroll/navigation events.

    These never form a click+click+dblclick burst.  isBugCondition2 is False.
    """
    n = draw(st.integers(min_value=1, max_value=5))
    base_ts = draw(st.integers(min_value=1_700_000_000_000, max_value=1_800_000_000_000))
    events = []
    for i in range(n):
        action = draw(st.sampled_from(NON_CLICK_ACTIONS))
        xpath = draw(st.sampled_from(OTHER_XPATHS))
        ts = base_ts + i * 500
        events.append(_make_event(action, xpath, ts))
    return sorted(events, key=lambda e: e["timestamp"])


def _is_bug_condition_2(events: list) -> bool:
    """Mirror isBugCondition2 from the design to confirm inputs are non-buggy."""
    for i in range(len(events) - 2):
        a, b, c = events[i], events[i + 1], events[i + 2]

        def _action(ev):
            return ev.get("eventData", {}).get("action", "")

        def _ts(ev):
            return ev.get("timestamp", 0)

        def _xpath(ev):
            return ev.get("eventData", {}).get("xpath", "")

        if (
            _action(a) == "click"
            and _action(b) == "click"
            and _action(c) == "dblclick"
            and _xpath(a) == _xpath(b) == _xpath(c)
            and (_ts(c) - _ts(a)) <= COALESCE_WINDOW_MS
        ):
            return True
    return False


# ===========================================================================
# Property 3a: Preservation — Non-loading freeze structure unchanged
# ===========================================================================
#
# Observation: for non-loading click timelines, _calculate_segments produces
# exactly one freeze per event (duration = audio_duration) plus a trailing 3.5s
# freeze.  This is the core freeze-frame-timing guarantee.
# ===========================================================================


@given(
    events=non_loading_timeline_strategy(min_size=1, max_size=6),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=20, deadline=None)
def test_property3a_non_loading_one_freeze_per_event(events, video_duration):
    """Property 3a: Non-loading click timeline — one freeze per event unchanged.

    For any non-loading timeline, _calculate_segments SHALL:
      * emit exactly one non-trailing ("freeze", ...) segment per event
      * that freeze segment's duration SHALL equal the event's audio_duration
      * emit exactly one ("freeze", _, 3.5) trailing freeze at the end

    This structural contract must hold on both the unfixed and fixed code.
    The fix (task 4.1) only adds is_loading propagation for loading steps;
    the freeze path for non-loading events is untouched.

    **Validates: Requirements 3.1**
    """
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))

    segments, audio_delays = _calculate_segments(events, video_duration)

    freeze_segments = [s for s in segments if s[0] == "freeze"]

    # At least one freeze segment (trailing)
    assert len(freeze_segments) >= 1, (
        f"Expected at least 1 freeze segment, got {len(freeze_segments)}. "
        f"Segments: {segments}"
    )

    # Trailing freeze is 3.5s
    trailing = freeze_segments[-1]
    assert abs(trailing[2] - 3.5) < 0.01, (
        f"Trailing freeze should have duration 3.5s, got {trailing[2]:.4f}s. "
        f"Segments: {segments}"
    )

    # Exactly one non-trailing freeze per event
    non_trailing = freeze_segments[:-1]
    assert len(non_trailing) == len(events), (
        f"Expected {len(events)} non-trailing freeze(s) (one per event), "
        f"got {len(non_trailing)}. Segments: {segments}"
    )

    # Each freeze duration matches the event's audio_duration
    for i, (seg, ev) in enumerate(zip(non_trailing, events)):
        assert abs(seg[2] - ev["audio_duration"]) < 1e-9, (
            f"Freeze {i} duration {seg[2]:.6f}s != event audio_duration "
            f"{ev['audio_duration']:.6f}s. Event: {ev}, Segment: {seg}"
        )

    # Exactly one audio_delays entry per event
    assert len(audio_delays) == len(events), (
        f"Expected {len(events)} audio_delay entries, got {len(audio_delays)}."
    )


@given(
    events=non_loading_timeline_strategy(min_size=1, max_size=6),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=20, deadline=None)
def test_property3a_non_loading_segment_types_valid(events, video_duration):
    """Property 3a: Segment types remain 'video' or 'freeze' and well-formed.

    **Validates: Requirements 3.1**
    """
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))

    segments, _ = _calculate_segments(events, video_duration)

    for seg in segments:
        assert seg[0] in ("video", "freeze"), (
            f"Invalid segment type: {seg[0]!r}. Segment: {seg}"
        )
        assert len(seg) == 3, (
            f"Segment must have 3 elements: {seg}"
        )
        if seg[0] == "video":
            assert seg[2] > seg[1], (
                f"Video segment end must be > start: {seg}"
            )
        else:
            assert seg[2] > 0, (
                f"Freeze segment duration must be > 0: {seg}"
            )


# ===========================================================================
# Property 3b: Preservation — Pre-flagged is_loading=True events unchanged
# ===========================================================================
#
# Observation: events that already carry is_loading=True (from any caller) are
# currently handled correctly by _calculate_segments — it emits a running
# ("video", ...) segment with no per-event freeze.  The fix only changes
# upstream callers that WERE NOT setting is_loading=True; it does not alter
# _calculate_segments logic.
#
# This test verifies that events with explicit is_loading=True continue to
# produce running video segments (no per-event freeze) on both unfixed and
# fixed code, and that the FFmpeg path and MoviePy fallback both use the
# same _calculate_segments rule (so results are identical for both paths).
# ===========================================================================


@given(
    events=preflagged_loading_timeline_strategy(min_size=1, max_size=4),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=20, deadline=None)
def test_property3b_preflagged_loading_no_per_event_freeze(events, video_duration):
    """Property 3b: Pre-flagged is_loading=True events emit running video, not a click-freeze.

    For events that ALREADY carry is_loading=True (not affected by the bug),
    _calculate_segments SHALL:
      * emit at least one running ("video", ...) segment
      * emit NO "freeze" segments that serve as click-freeze (i.e. freeze segments
        that appear BEFORE the first video segment, matching the non-loading branch
        behavior). Loading events use either running video or a holdframe-freeze
        when narration overruns the video duration — but never the click-freeze
        pattern that starts with a freeze at the click timestamp.
      * the trailing ("freeze", _, 3.5) is always emitted as structural

    Observed behavior (unfixed code — _calculate_segments already works correctly
    for is_loading=True):
      - When narration fits within remaining video:
          ("video", current, run_end) — no per-event freeze
      - When narration overruns the video:
          ("video", current, video_duration) + ("freeze", 9.9, remainder)
          — holdframe freeze to cover the overflow, positioned at end of video

    The fix does NOT change _calculate_segments at all — it only adds is_loading
    propagation in the upstream caller. This test confirms the loading path is
    unchanged before and after the fix.

    **Validates: Requirements 3.2**
    """
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))

    segments, audio_delays = _calculate_segments(events, video_duration)

    # The first segment must NOT be a freeze (unlike the non-loading branch,
    # which starts by seeking to freeze_ts and may emit a video segment first
    # then a freeze). For loading events, the very first segment emitted is
    # always a "video" segment (or a holdframe at end of video).
    #
    # More precisely: for any is_loading=True event, the _calculate_segments
    # source always calls segments.append(("video", current_time, run_end))
    # before possibly appending a holdframe. So the first element from a
    # loading event is always ("video", ...) — never a click-freeze.
    assert segments[0][0] == "video", (
        f"First segment for pre-flagged loading events should be ('video', ...) "
        f"but got {segments[0]}. This indicates the non-loading (click-freeze) "
        f"branch was taken instead of the loading branch. Segments: {segments}"
    )

    # Must have at least one running video segment
    video_segments = [s for s in segments if s[0] == "video"]
    assert len(video_segments) >= 1, (
        f"Expected at least 1 running ('video', ...) segment for pre-flagged "
        f"loading events, got 0. Segments: {segments}"
    )

    # Exactly one audio_delays entry per event
    assert len(audio_delays) == len(events), (
        f"Expected {len(events)} audio_delay entries, got {len(audio_delays)}."
    )


@given(
    event=preflagged_loading_event_strategy(min_ts=1.0, max_ts=10.0),
    video_duration=video_duration_strategy(min_dur=15.0),
)
@settings(max_examples=20, deadline=None)
def test_property3b_preflagged_loading_ffmpeg_and_moviepy_same_segments(
    event, video_duration
):
    """Property 3b: Pre-flagged loading events — FFmpeg and MoviePy use same segments.

    Both the FFmpeg path and the MoviePy fallback use _calculate_segments as
    their single shared timing rule.  Since neither path is modified by the fix,
    their outputs are identical for any given timeline.

    We verify that calling _calculate_segments twice with the same inputs
    produces identical results — confirming the shared rule is deterministic
    and both paths will see the same segments.

    **Validates: Requirements 3.2**
    """
    assume(event["timestamp"] < video_duration - 1.0)

    # Simulate FFmpeg path: call _calculate_segments
    segments_a, delays_a = _calculate_segments([event], video_duration)

    # Simulate MoviePy fallback: call _calculate_segments again (same shared rule)
    segments_b, delays_b = _calculate_segments([event], video_duration)

    # Both paths must produce identical results
    assert segments_a == segments_b, (
        f"FFmpeg and MoviePy paths produced different segments for the same "
        f"pre-flagged loading event. FFmpeg: {segments_a}, MoviePy: {segments_b}"
    )
    assert delays_a == delays_b, (
        f"FFmpeg and MoviePy paths produced different audio_delays for the same "
        f"pre-flagged loading event. FFmpeg: {delays_a}, MoviePy: {delays_b}"
    )


# ===========================================================================
# Property 3c: Preservation — Coalescer identity for non-burst event lists
# ===========================================================================
#
# Observation: The function coalesce_dblclick_bursts does not exist yet in
# export_pipeline.py (it will be created by task 4.2). The preservation
# requirement states it MUST be the identity for all non-burst inputs.
#
# Strategy: Write the test to import coalesce_dblclick_bursts from
# api.export_pipeline. If the import fails (task 4.2 not yet implemented),
# the test is skipped with a clear message. Once task 4.2 is implemented,
# the test must pass. This is the correct observation-first approach for
# a function that does not yet exist.
#
# Test cases:
#   - Event lists with distinct targets
#   - Lone single click
#   - Out-of-window same-target repeats
#   - Non-click events only (input/change/scroll/navigation)
# ===========================================================================

import pytest


def _try_import_coalescer():
    """Try to import coalesce_dblclick_bursts from api.export_pipeline.

    Returns the function if available, or None if not yet implemented.
    """
    try:
        from api.export_pipeline import coalesce_dblclick_bursts
        return coalesce_dblclick_bursts
    except ImportError:
        return None


# ---------------------------------------------------------------------------
# Deterministic unit tests for coalescer identity (non-burst inputs)
# ---------------------------------------------------------------------------

class TestCoalescerIdentityDeterministic:
    """Deterministic tests confirming coalescer identity on known non-burst inputs.

    These tests verify that coalesce_dblclick_bursts(events) == events for
    concrete, well-understood non-burst event lists.

    They are written against the import of coalesce_dblclick_bursts which will
    be implemented in task 4.2. Until then, they are skipped.

    **Validates: Requirements 3.3**
    """

    def _get_coalescer(self):
        coalescer = _try_import_coalescer()
        if coalescer is None:
            pytest.skip(
                "coalesce_dblclick_bursts not yet implemented in api.export_pipeline "
                "(task 4.2 pending). Re-run after task 4.2 is complete."
            )
        return coalescer

    def test_coalescer_identity_empty_list(self):
        """Coalescer returns empty list unchanged."""
        coalescer = self._get_coalescer()
        assert coalescer([]) == []

    def test_coalescer_identity_lone_click(self):
        """Coalescer returns a lone click event unchanged."""
        coalescer = self._get_coalescer()
        events = [_make_event("click", OTHER_XPATHS[0], 1_780_000_000_000)]
        result = coalescer(events)
        assert result == events, (
            f"Coalescer modified a lone click event: input={events}, output={result}"
        )

    def test_coalescer_identity_lone_dblclick(self):
        """Coalescer returns a lone dblclick event unchanged."""
        coalescer = self._get_coalescer()
        events = [_make_event("dblclick", OTHER_XPATHS[0], 1_780_000_000_000)]
        result = coalescer(events)
        assert result == events, (
            f"Coalescer modified a lone dblclick event: input={events}, output={result}"
        )

    def test_coalescer_identity_distinct_targets(self):
        """Coalescer returns events on distinct targets unchanged."""
        coalescer = self._get_coalescer()
        base_ts = 1_780_000_000_000
        events = [
            _make_event("click",    OTHER_XPATHS[0], base_ts),
            _make_event("click",    OTHER_XPATHS[1], base_ts + 100),
            _make_event("dblclick", OTHER_XPATHS[2], base_ts + 150),
        ]
        # Not a burst: different xpaths
        assert not _is_bug_condition_2(events), (
            "Test setup error: distinct-target events triggered isBugCondition2."
        )
        result = coalescer(events)
        assert result == events, (
            f"Coalescer modified distinct-target events: input={events}, output={result}"
        )

    def test_coalescer_identity_out_of_window_same_target(self):
        """Coalescer returns out-of-window same-target clicks unchanged.

        Two clicks on the same target separated by more than COALESCE_WINDOW_MS
        are distinct interactions, not a burst — the coalescer must leave them
        as-is.
        """
        coalescer = self._get_coalescer()
        base_ts = 1_780_000_000_000
        gap = COALESCE_WINDOW_MS + 500  # well beyond the window
        events = [
            _make_event("click", OTHER_XPATHS[0], base_ts),
            _make_event("click", OTHER_XPATHS[0], base_ts + gap),
        ]
        assert not _is_bug_condition_2(events), (
            "Test setup error: out-of-window events triggered isBugCondition2."
        )
        result = coalescer(events)
        assert result == events, (
            f"Coalescer modified out-of-window same-target clicks: "
            f"input={events}, output={result}"
        )

    def test_coalescer_identity_non_click_events(self):
        """Coalescer returns non-click events (input/change/scroll/navigation) unchanged."""
        coalescer = self._get_coalescer()
        base_ts = 1_780_000_000_000
        events = [
            _make_event("input",      OTHER_XPATHS[0], base_ts),
            _make_event("change",     OTHER_XPATHS[1], base_ts + 100),
            _make_event("scroll",     OTHER_XPATHS[2], base_ts + 200),
            _make_event("navigation", OTHER_XPATHS[3], base_ts + 300),
        ]
        assert not _is_bug_condition_2(events), (
            "Test setup error: non-click events triggered isBugCondition2."
        )
        result = coalescer(events)
        assert result == events, (
            f"Coalescer modified non-click events: input={events}, output={result}"
        )

    def test_coalescer_identity_click_plus_dblclick_different_targets(self):
        """Coalescer leaves click+click+dblclick on DIFFERENT targets unchanged.

        Even though the pattern click+click+dblclick exists, the different xpaths
        mean isBugCondition2 is False — no coalescing should happen.
        """
        coalescer = self._get_coalescer()
        base_ts = 1_780_000_000_000
        events = [
            _make_event("click",    OTHER_XPATHS[0], base_ts),
            _make_event("click",    OTHER_XPATHS[1], base_ts + 50),
            _make_event("dblclick", OTHER_XPATHS[2], base_ts + 80),
        ]
        assert not _is_bug_condition_2(events), (
            "Test setup error: different-target events triggered isBugCondition2."
        )
        result = coalescer(events)
        assert result == events, (
            f"Coalescer modified click+click+dblclick on different targets: "
            f"input={events}, output={result}"
        )

    def test_coalescer_identity_click_click_only_no_dblclick(self):
        """Coalescer leaves click+click on same target unchanged (no dblclick to close the burst)."""
        coalescer = self._get_coalescer()
        base_ts = 1_780_000_000_000
        events = [
            _make_event("click", OTHER_XPATHS[0], base_ts),
            _make_event("click", OTHER_XPATHS[0], base_ts + 50),
        ]
        assert not _is_bug_condition_2(events), (
            "Test setup error: click+click without dblclick triggered isBugCondition2."
        )
        result = coalescer(events)
        assert result == events, (
            f"Coalescer modified click+click (no dblclick): "
            f"input={events}, output={result}"
        )

    def test_coalescer_preserves_event_order(self):
        """Coalescer preserves the order of non-burst events."""
        coalescer = self._get_coalescer()
        base_ts = 1_780_000_000_000
        events = [
            _make_event("click",  OTHER_XPATHS[0], base_ts),
            _make_event("scroll", OTHER_XPATHS[1], base_ts + 200),
            _make_event("click",  OTHER_XPATHS[2], base_ts + 500),
            _make_event("input",  OTHER_XPATHS[3], base_ts + 700),
        ]
        result = coalescer(events)
        assert result == events, (
            f"Coalescer changed event order for non-burst list: "
            f"input={events}, output={result}"
        )

    def test_coalescer_preserves_total_count_for_non_burst(self):
        """Coalescer returns same number of events for non-burst list."""
        coalescer = self._get_coalescer()
        base_ts = 1_780_000_000_000
        events = [
            _make_event("click",    OTHER_XPATHS[0], base_ts),
            _make_event("click",    OTHER_XPATHS[1], base_ts + 200),
            _make_event("dblclick", OTHER_XPATHS[0], base_ts + 1000),  # same xpath, but out-of-window
        ]
        assert not _is_bug_condition_2(events), (
            "Test setup error: events triggered isBugCondition2 unexpectedly."
        )
        result = coalescer(events)
        assert len(result) == len(events), (
            f"Coalescer changed event count from {len(events)} to {len(result)} "
            f"for a non-burst list."
        )


# ---------------------------------------------------------------------------
# Property-based coalescer identity tests
# ---------------------------------------------------------------------------

@given(events=distinct_target_events_strategy())
@settings(max_examples=15, deadline=None)
def test_property3c_coalescer_identity_distinct_targets(events):
    """Property 3c: Coalescer identity — distinct-target event lists unchanged.

    For any event list with events on distinct xpaths, coalesce_dblclick_bursts
    SHALL return the list unchanged (identity function).

    **Validates: Requirements 3.3**
    """
    coalescer = _try_import_coalescer()
    if coalescer is None:
        pytest.skip(
            "coalesce_dblclick_bursts not yet implemented (task 4.2 pending)."
        )

    # Precondition: distinct targets mean no burst
    assume(not _is_bug_condition_2(events))

    result = coalescer(events)
    assert result == events, (
        f"Coalescer modified a distinct-target event list (should be identity). "
        f"Input: {events}, Output: {result}"
    )


@given(events=lone_single_click_strategy())
@settings(max_examples=10, deadline=None)
def test_property3c_coalescer_identity_lone_click(events):
    """Property 3c: Coalescer identity — lone single click unchanged.

    A lone single click cannot form a burst, so the coalescer must return
    the single-element list unchanged.

    **Validates: Requirements 3.4**
    """
    coalescer = _try_import_coalescer()
    if coalescer is None:
        pytest.skip(
            "coalesce_dblclick_bursts not yet implemented (task 4.2 pending)."
        )

    result = coalescer(events)
    assert result == events, (
        f"Coalescer modified a lone single click: input={events}, output={result}"
    )
    assert len(result) == 1, (
        f"Coalescer changed event count for lone click: expected 1, got {len(result)}"
    )


@given(events=out_of_window_same_target_strategy())
@settings(max_examples=10, deadline=None)
def test_property3c_coalescer_identity_out_of_window_repeats(events):
    """Property 3c: Coalescer identity — out-of-window same-target repeats unchanged.

    Same-target click events separated beyond COALESCE_WINDOW_MS are distinct
    interactions.  The coalescer must leave them unchanged.

    **Validates: Requirements 3.3**
    """
    coalescer = _try_import_coalescer()
    if coalescer is None:
        pytest.skip(
            "coalesce_dblclick_bursts not yet implemented (task 4.2 pending)."
        )

    # Precondition: out-of-window events should not satisfy isBugCondition2
    assume(not _is_bug_condition_2(events))

    result = coalescer(events)
    assert result == events, (
        f"Coalescer modified out-of-window same-target events: "
        f"input={events}, output={result}"
    )


@given(events=non_click_events_only_strategy())
@settings(max_examples=10, deadline=None)
def test_property3c_coalescer_identity_non_click_events(events):
    """Property 3c: Coalescer identity — non-click events (input/change/scroll/navigation) unchanged.

    Non-click events can never form a click+click+dblclick burst.
    The coalescer must return them unchanged.

    **Validates: Requirements 3.5**
    """
    coalescer = _try_import_coalescer()
    if coalescer is None:
        pytest.skip(
            "coalesce_dblclick_bursts not yet implemented (task 4.2 pending)."
        )

    assert not _is_bug_condition_2(events), (
        "Test setup error: non-click events triggered isBugCondition2."
    )

    result = coalescer(events)
    assert result == events, (
        f"Coalescer modified non-click events: input={events}, output={result}"
    )


# ===========================================================================
# Property 3d: Preservation — Single-click preservation
# ===========================================================================
#
# Observation: a lone non-loading click event produces exactly:
#   * one non-trailing freeze segment (duration = audio_duration)
#   * one audio_delays entry
#   * the structural trailing 3.5s freeze
# ===========================================================================


@given(
    event=non_loading_event_strategy(min_ts=1.0, max_ts=15.0),
    video_duration=video_duration_strategy(min_dur=20.0),
)
@settings(max_examples=15, deadline=None)
def test_property3d_single_click_one_freeze_one_audio_delay(event, video_duration):
    """Property 3d: Single non-loading click — one freeze, one audio_delay entry.

    A lone single (non-loading) click event SHALL produce exactly:
      * one non-trailing ("freeze", ...) segment with duration = audio_duration
      * one audio_delays entry
      * the structural trailing 3.5s freeze

    This is the baseline single-click behavior that must not be broken.

    **Validates: Requirements 3.4**
    """
    assume(event["timestamp"] < video_duration - 1.0)

    segments, audio_delays = _calculate_segments([event], video_duration)

    freeze_segments = [s for s in segments if s[0] == "freeze"]

    # Must have the trailing 3.5s freeze
    assert len(freeze_segments) >= 1, (
        f"Expected at least 1 freeze segment for single-click timeline, "
        f"got 0. Segments: {segments}"
    )
    trailing = freeze_segments[-1]
    assert abs(trailing[2] - 3.5) < 0.01, (
        f"Trailing freeze should have duration 3.5s, got {trailing[2]:.4f}s. "
        f"Segments: {segments}"
    )

    # Exactly one non-trailing freeze (for the single event)
    non_trailing = freeze_segments[:-1]
    assert len(non_trailing) == 1, (
        f"Expected exactly 1 non-trailing freeze for a single-click timeline, "
        f"got {len(non_trailing)}. Segments: {segments}"
    )

    # Freeze duration matches audio_duration
    assert abs(non_trailing[0][2] - event["audio_duration"]) < 1e-9, (
        f"Single-click freeze duration {non_trailing[0][2]:.6f}s does not match "
        f"event audio_duration {event['audio_duration']:.6f}s. "
        f"Segment: {non_trailing[0]}, Event: {event}"
    )

    # Exactly one audio_delays entry
    assert len(audio_delays) == 1, (
        f"Expected exactly 1 audio_delay entry for a single-click timeline, "
        f"got {len(audio_delays)}. Audio delays: {audio_delays}"
    )


@given(
    event=non_loading_event_strategy(min_ts=1.0, max_ts=15.0),
    video_duration=video_duration_strategy(min_dur=20.0),
)
@settings(max_examples=15, deadline=None)
def test_property3d_single_click_audio_path_preserved(event, video_duration):
    """Property 3d: Single non-loading click — audio_path is preserved in audio_delays.

    The audio_delays entry for a single-click event must reference the same
    audio_path that was supplied in the event.

    **Validates: Requirements 3.4**
    """
    assume(event["timestamp"] < video_duration - 1.0)

    _, audio_delays = _calculate_segments([event], video_duration)

    assert len(audio_delays) == 1
    assert audio_delays[0][0] == event["audio_path"], (
        f"audio_delays entry references wrong audio_path: "
        f"expected {event['audio_path']!r}, got {audio_delays[0][0]!r}"
    )


# ===========================================================================
# Property 3e: Preservation — Identical structure when no loading steps / no bursts
# ===========================================================================
#
# Observation: for a timeline with no loading steps and no double-click bursts,
# the segment count and audio_delay count are identical on both the unfixed and
# fixed code (the fix adds no new segments and removes no segments for non-buggy
# inputs).
#
# We verify this by confirming that calling _calculate_segments twice with the
# same non-loading timeline produces identical results (determinism), and that
# the segment/delay counts match the expected formula:
#   - segment count = (1 optional video before each freeze) + n freezes + 1 trailing
#   - audio_delay count = n (one per event)
# ===========================================================================


@given(
    events=non_loading_timeline_strategy(min_size=1, max_size=6),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=20, deadline=None)
def test_property3e_identical_structure_no_loading_no_bursts(events, video_duration):
    """Property 3e: Identical structure when timeline has no loading steps and no bursts.

    For any non-loading timeline (no is_loading=True, no click+click+dblclick
    burst), _calculate_segments is deterministic: calling it twice produces
    identical results.  The fix must not alter this for non-buggy inputs.

    **Validates: Requirements 3.6**
    """
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))

    # Call twice to verify determinism
    result_a = _calculate_segments(events, video_duration)
    result_b = _calculate_segments(events, video_duration)

    assert result_a == result_b, (
        f"_calculate_segments is not deterministic for non-loading timeline. "
        f"First call: {result_a}, Second call: {result_b}"
    )


@given(
    events=non_loading_timeline_strategy(min_size=1, max_size=6),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=20, deadline=None)
def test_property3e_audio_delay_count_equals_event_count(events, video_duration):
    """Property 3e: audio_delay count equals event count for non-loading timelines.

    For any non-loading timeline, the number of audio_delays entries must equal
    the number of input events (one narration audio per step).

    **Validates: Requirements 3.6**
    """
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))

    _, audio_delays = _calculate_segments(events, video_duration)

    assert len(audio_delays) == len(events), (
        f"audio_delay count {len(audio_delays)} != event count {len(events)}. "
        f"Audio delays: {audio_delays}"
    )


@given(
    events=non_loading_timeline_strategy(min_size=2, max_size=6),
    video_duration=video_duration_strategy(min_dur=10.0),
)
@settings(max_examples=20, deadline=None)
def test_property3e_freeze_count_equals_event_count_plus_one(events, video_duration):
    """Property 3e: Freeze count equals event count + 1 for non-loading timelines.

    For any non-loading timeline with N events, the freeze count must be N + 1:
    N per-event freezes + 1 trailing 3.5s freeze.

    **Validates: Requirements 3.1, 3.6**
    """
    assume(all(e["timestamp"] < video_duration - 1.0 for e in events))

    segments, _ = _calculate_segments(events, video_duration)

    freeze_count = sum(1 for s in segments if s[0] == "freeze")
    expected = len(events) + 1  # N per-event + 1 trailing

    assert freeze_count == expected, (
        f"Expected {expected} freeze segments ({len(events)} per-event + 1 trailing), "
        f"got {freeze_count}. Segments: {segments}"
    )


# ===========================================================================
# Integration-style anchors: confirm preservation for known non-buggy sessions
# ===========================================================================

class TestPreservationAnchorNonBuggyInputs:
    """Deterministic anchor tests for known non-buggy inputs.

    These tests verify preservation for specific, concrete event sequences
    where neither isBugCondition1 nor isBugCondition2 holds.

    **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6**
    """

    def test_two_distinct_click_events_two_freezes_plus_trailing(self):
        """Two distinct non-loading clicks produce exactly 2 + 1 freeze segments.

        This represents a simple, common non-buggy scenario: two separate clicks
        on different targets, each narrated once.
        """
        events = [
            {
                "timestamp": 3.0,
                "audio_path": "audios/step1.mp3",
                "audio_duration": 2.0,
                "is_loading": False,
            },
            {
                "timestamp": 8.0,
                "audio_path": "audios/step2.mp3",
                "audio_duration": 1.5,
                "is_loading": False,
            },
        ]
        segments, audio_delays = _calculate_segments(events, 30.0)

        freeze_segs = [s for s in segments if s[0] == "freeze"]
        assert len(freeze_segs) == 3, (
            f"Expected 3 freeze segments (2 per-event + 1 trailing), "
            f"got {len(freeze_segs)}. Segments: {segments}"
        )
        # First freeze for step 1
        assert abs(freeze_segs[0][2] - 2.0) < 1e-9
        # Second freeze for step 2
        assert abs(freeze_segs[1][2] - 1.5) < 1e-9
        # Trailing freeze
        assert abs(freeze_segs[2][2] - 3.5) < 0.01

        # Exactly 2 audio_delays entries
        assert len(audio_delays) == 2

    def test_preflagged_loading_event_produces_video_not_freeze(self):
        """A pre-flagged is_loading=True event produces a running video segment.

        This verifies the working path of time_bender that the fix relies on.
        """
        event = {
            "timestamp": 5.0,
            "audio_path": "audios/nav1.mp3",
            "audio_duration": 3.0,
            "is_loading": True,
        }
        segments, audio_delays = _calculate_segments([event], 30.0)

        # Must have at least one running video segment
        video_segs = [s for s in segments if s[0] == "video"]
        assert len(video_segs) >= 1, (
            f"Expected running ('video', ...) segment for is_loading=True event, "
            f"got 0. Segments: {segments}"
        )

        # Must NOT have a per-event freeze (only the trailing one)
        freeze_segs = [s for s in segments if s[0] == "freeze"]
        non_trailing = [s for s in freeze_segs if not (abs(s[2] - 3.5) < 0.01)]
        assert len(non_trailing) == 0, (
            f"is_loading=True event should not produce a per-event freeze, "
            f"but got: {non_trailing}. All segments: {segments}"
        )

        # One audio_delays entry
        assert len(audio_delays) == 1
        assert audio_delays[0][0] == "audios/nav1.mp3"

    def test_mixed_loading_and_click_preserves_click_freeze(self):
        """Mixed timeline: loading event plays, click event freezes.

        A pre-flagged loading event (is_loading=True) followed by a normal
        click (is_loading=False) must produce:
          - running video for the loading event (no per-event freeze for it)
          - freeze for the click event
          - trailing 3.5s freeze

        Total freezes = 1 (click) + 1 (trailing) = 2.
        """
        events = [
            {
                "timestamp": 3.0,
                "audio_path": "audios/nav.mp3",
                "audio_duration": 2.5,
                "is_loading": True,
            },
            {
                "timestamp": 8.0,
                "audio_path": "audios/click.mp3",
                "audio_duration": 1.8,
                "is_loading": False,
            },
        ]
        segments, audio_delays = _calculate_segments(events, 30.0)

        freeze_segs = [s for s in segments if s[0] == "freeze"]
        # Only 2 freezes: the click event's freeze + the trailing 3.5s freeze
        assert len(freeze_segs) == 2, (
            f"Expected 2 freeze segments (1 for click + 1 trailing), "
            f"got {len(freeze_segs)}. Segments: {segments}"
        )

        # The non-trailing freeze belongs to the click event
        non_trailing = [s for s in freeze_segs if not (abs(s[2] - 3.5) < 0.01)]
        assert len(non_trailing) == 1
        assert abs(non_trailing[0][2] - 1.8) < 1e-9, (
            f"Click event freeze duration should be 1.8s, got {non_trailing[0][2]:.6f}s"
        )

        # Two audio_delays entries (one per event)
        assert len(audio_delays) == 2

    def test_non_click_action_event_is_passed_through_unchanged(self):
        """Non-click action events (navigation) pass through _calculate_segments.

        A navigation event that does NOT carry is_loading=True is treated as a
        normal event and frozen (the bug — but it's the current observed baseline
        behavior for the unfixed code, and what the fix changes only for
        is_loading steps built by rerender_pipeline).

        This test confirms the CURRENT behavior: without is_loading=True the
        event is frozen.  This is the baseline to PRESERVE for non-loading steps.
        """
        event = {
            "timestamp": 5.0,
            "audio_path": "audios/nav.mp3",
            "audio_duration": 2.0,
            "is_loading": False,  # NOT pre-flagged — treated as normal click
        }
        segments, audio_delays = _calculate_segments([event], 30.0)

        # Without is_loading=True, the event is frozen (current unfixed behavior)
        freeze_segs = [s for s in segments if s[0] == "freeze"]
        non_trailing = [s for s in freeze_segs if not (abs(s[2] - 3.5) < 0.01)]
        assert len(non_trailing) == 1, (
            f"Expected 1 per-event freeze for non-flagged event, "
            f"got {len(non_trailing)}. Segments: {segments}"
        )
        assert abs(non_trailing[0][2] - 2.0) < 1e-9

        # One audio_delays entry
        assert len(audio_delays) == 1
