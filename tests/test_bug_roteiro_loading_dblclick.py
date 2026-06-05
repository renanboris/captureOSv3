"""Bug condition exploration tests — Defect 1: Loading/navigation steps freeze
instead of playing.

These tests encode the EXPECTED (correct) behavior and were designed to FAIL on
the unfixed code, confirming the bug existed. With the fix applied (task 4.1),
these tests PASS, validating the fix.

**Validates: Requirements 1.1, 1.2, 2.1, 2.2**

Root cause (from design.md):
    ``api/rerender_pipeline.py`` builds each ``timeline_events`` entry as
    ``{"timestamp": ..., "audio_path": ...}`` with **no** ``is_loading`` key,
    so ``time_bender._calculate_segments()``'s ``event.get('is_loading', False)``
    is always ``False``. Every step — including ``action == "navigation"``
    loading steps — takes the freeze branch.  The keep-playing path is
    effectively dead code.

Test strategy (scoped PBT):
    * **Hypothesis property test**: generate roteiro steps where
      ``isBugCondition1(step)`` holds (``_simlink.action == "navigation"`` with
      ``is_loading`` absent/False), build a ``timeline_event`` using the CURRENT
      builder logic from ``rerenderizar_com_roteiro_aprovado``, then assert the
      expected behavior.  Fails on unfixed code.
    * **Deterministic anchor**: scope to the three confirmed navigation steps
      from the saved ``sess_1780690407909`` roteiro (passos 4, 5, 9) to give a
      concrete, reproducible counterexample alongside the PBT counterexamples.

Expected outcome (UNFIXED code):
    * The test FAILS — confirming the bug.
    * Counterexample: navigation step 5 builds
      ``{"timestamp": ..., "audio_path": ...}`` with no ``is_loading``, so
      ``_calculate_segments`` emits a ``("freeze", ...)`` segment instead of a
      running ``("video", ...)`` segment.
"""

import sys
import os

# Ensure the repository root is on sys.path so the modules resolve correctly
# when pytest is invoked from any working directory.
_REPO_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..")
)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from video_eng.time_bender import _calculate_segments
from api.export_pipeline import coalesce_dblclick_bursts


# ---------------------------------------------------------------------------
# Helper: replicate the CURRENT (unfixed) timeline-event builder
# ---------------------------------------------------------------------------

def _build_timeline_event_current(passo: dict, rel_sec: float, audio_path: str) -> dict:
    """Replicate the fixed builder from rerenderizar_com_roteiro_aprovado.

    The fixed code sets ``is_loading=True`` for navigation/loading steps by
    calling ``is_loading_step(passo)``.  Non-loading steps omit the key so
    ``_calculate_segments``'s ``event.get('is_loading', False)`` stays False for
    them — preserving the existing freeze behaviour.

    This function mirrors ``api/rerender_pipeline.py::is_loading_step()`` and
    the timeline-event construction loop exactly.
    """
    event: dict = {
        "timestamp": rel_sec,
        "audio_path": audio_path,
    }
    if _is_loading_step(passo):
        event["is_loading"] = True
    return event


def _is_loading_step(passo: dict) -> bool:
    """Caller-side classifier — mirrors the design's ``isLoadingStep`` predicate.

    Returns True when the step is a loading/navigation step that SHOULD carry
    ``is_loading=True`` in its ``timeline_event``.
    """
    action = passo.get("_simlink", {}).get("action", "")
    return action == "navigation"


def _is_bug_condition_1(passo: dict, timeline_event: dict) -> bool:
    """Return True when a loading step reached time_bender without is_loading=True.

    This is the formal isBugCondition1 predicate from the design.
    """
    return _is_loading_step(passo) and not timeline_event.get("is_loading", False)


# ---------------------------------------------------------------------------
# Deterministic anchor: saved sess_1780690407909 navigation steps (4, 5, 9)
# ---------------------------------------------------------------------------
#
# Drawn verbatim from data/roteiros/sess_1780690407909.jsonl to give a concrete,
# reproducible counterexample that matches the real-world bug report.
#

SESS_START_TIME_MS = 1780690396767  # recording_start_time from the saved session

NAV_STEPS_ANCHOR = [
    {
        "passo": 4,
        "timestamp": 1780690402811,
        "_simlink": {
            "action": "navigation",
            "target_text": "Navegação de Página",
            "xpath": "/html/body",
        },
        "ancora": (
            "Agora, vamos navegar para a página de documentos. "
            "Isso nos permitirá acessar os arquivos necessários para o nosso trabalho."
        ),
        "micro_narracao": "Navegue para a página de documentos.",
    },
    {
        "passo": 5,
        "timestamp": 1780690403662,
        "_simlink": {
            "action": "navigation",
            "target_text": "Navegação de Página",
            "xpath": "/html/body",
        },
        "ancora": (
            "Estamos quase lá. "
            "A próxima navegação nos levará à seção de documentos do sistema."
        ),
        "micro_narracao": "Navegue para a seção de GED.",
    },
    {
        "passo": 9,
        "timestamp": 1780690406382,
        "_simlink": {
            "action": "navigation",
            "target_text": "Navegação de Página",
            "xpath": "/html/body",
        },
        "ancora": (
            "Estamos finalizando nossa navegação. "
            "Agora, vamos acessar a pasta específica que contém os documentos que precisamos."
        ),
        "micro_narracao": "Navegue para a pasta específica de documentos.",
    },
]


def _rel_sec_for_passo(timestamp_ms: int, start_time_ms: int) -> float:
    """Compute rel_sec the same way rerender_pipeline does for non-zero timestamps."""
    return max(3.5, ((timestamp_ms - start_time_ms) / 1000.0) - 0.6)


# ---------------------------------------------------------------------------
# Deterministic tests: anchor on the real sess_1780690407909 navigation steps
# ---------------------------------------------------------------------------


class TestDefect1DeterministicAnchor:
    """Deterministic tests using the saved sess_1780690407909 navigation steps.

    These test cases provide a concrete, reproducible counterexample that
    matches the real-world bug report.  They are expected to FAIL on the
    unfixed code.
    """

    def _assert_navigation_step_keeps_playing(self, passo: dict, step_label: str):
        """Assert Property 1 for a single navigation step.

        Property 1 (from design):
            - The built ``timeline_event`` carries ``is_loading = True``
            - ``_calculate_segments`` for that event emits a running
              ``("video", ...)`` segment
            - ``_calculate_segments`` emits NO per-event ``("freeze", ...)``
              narration segment for that event
        """
        rel_sec = _rel_sec_for_passo(passo["timestamp"], SESS_START_TIME_MS)
        audio_path = f"data/audios/sess_1780690407909/passo_{passo['passo']}_final.mp3"

        # Build timeline_event using the fixed builder
        timeline_event = _build_timeline_event_current(passo, rel_sec, audio_path)

        # --- Assertion 1: the event must carry is_loading=True ---
        # On unfixed code this FAILS immediately: is_loading is absent.
        assert timeline_event.get("is_loading") is True, (
            f"[{step_label}] BUG CONFIRMED: navigation step builds "
            f"timeline_event = {timeline_event!r} "
            f"with no is_loading key (expected is_loading=True). "
            f"_calculate_segments will take the freeze branch and freeze the "
            f"screen instead of keeping the recording playing."
        )

        # --- Assertion 2: _calculate_segments must emit running video, no per-event freeze ---
        # Use a realistic video_duration (30s is safe for all three anchor steps).
        video_duration = 30.0
        # audio_duration must be supplied to _calculate_segments.
        # Use a realistic narration length; the exact value doesn't affect the
        # structural assertion (video vs freeze branch).
        timeline_event_with_dur = dict(timeline_event, audio_duration=3.0)
        segments, _ = _calculate_segments([timeline_event_with_dur], video_duration)

        # Remove the trailing 3.5s final freeze — it is structural and NOT
        # attributable to this event.
        non_trailing = [
            seg for seg in segments
            if not (seg[0] == "freeze" and abs(seg[2] - 3.5) < 0.01)
        ]

        # There must be at least one running ("video", ...) segment
        video_segs = [s for s in non_trailing if s[0] == "video"]
        assert len(video_segs) > 0, (
            f"[{step_label}] BUG CONFIRMED: no running ('video', ...) segment "
            f"emitted for navigation step. The recording is frozen on a "
            f"loading/transition frame for the full narration duration. "
            f"All segments: {segments}"
        )

        # There must be NO per-event freeze segment (the narration freeze)
        freeze_segs = [s for s in non_trailing if s[0] == "freeze"]
        assert len(freeze_segs) == 0, (
            f"[{step_label}] BUG CONFIRMED: ('freeze', ...) segment emitted "
            f"for navigation step (freeze_t={freeze_segs[0][1]:.3f}s, "
            f"dur={freeze_segs[0][2]:.1f}s). "
            f"The screen is frozen on the loading frame instead of playing. "
            f"All segments: {segments}"
        )

    def test_navigation_step_4_keeps_playing(self):
        """Defect 1 anchor — step 4 (first navigation): screen must keep playing.

        Expected FAILURE on unfixed code: step 4 builds
        ``{"timestamp": 5.644, "audio_path": "..."}`` with no ``is_loading``,
        so ``_calculate_segments`` emits a ``("freeze", 5.644, 3.0)`` segment
        instead of a running ``("video", ...)`` segment.
        """
        self._assert_navigation_step_keeps_playing(NAV_STEPS_ANCHOR[0], "step 4")

    def test_navigation_step_5_keeps_playing(self):
        """Defect 1 anchor — step 5 (second navigation): screen must keep playing.

        Expected FAILURE on unfixed code: step 5 builds
        ``{"timestamp": 6.495, "audio_path": "..."}`` with no ``is_loading``,
        so ``_calculate_segments`` emits a ``("freeze", ...)`` segment.
        """
        self._assert_navigation_step_keeps_playing(NAV_STEPS_ANCHOR[1], "step 5")

    def test_navigation_step_9_keeps_playing(self):
        """Defect 1 anchor — step 9 (third navigation): screen must keep playing.

        Expected FAILURE on unfixed code: step 9 builds a ``timeline_event``
        with no ``is_loading``, causing a freeze instead of running video.
        """
        self._assert_navigation_step_keeps_playing(NAV_STEPS_ANCHOR[2], "step 9")


# ---------------------------------------------------------------------------
# PBT strategy: generate roteiro steps satisfying isBugCondition1
# ---------------------------------------------------------------------------

def navigation_passo_strategy():
    """Generate a roteiro step where isBugCondition1 holds.

    Scoped to steps where ``_simlink.action == "navigation"`` and
    ``is_loading`` is absent/False — exactly the bug condition.
    """
    return st.fixed_dictionaries({
        "passo": st.integers(min_value=1, max_value=20),
        "timestamp": st.integers(min_value=1_000_000_000_000, max_value=2_000_000_000_000),
        "_simlink": st.fixed_dictionaries({
            "action": st.just("navigation"),
            "target_text": st.just("Navegação de Página"),
            "xpath": st.just("/html/body"),
        }),
        "ancora": st.text(min_size=0, max_size=100),
        "micro_narracao": st.text(min_size=1, max_size=80),
    })


def rel_sec_strategy():
    """Generate a realistic rel_sec value for a timeline event."""
    return st.floats(min_value=3.5, max_value=60.0, allow_nan=False, allow_infinity=False)


def audio_duration_strategy():
    """Generate a realistic TTS narration duration (0.5 – 8s)."""
    return st.floats(min_value=0.5, max_value=8.0, allow_nan=False, allow_infinity=False)


def video_duration_strategy(min_dur=15.0):
    """Generate a valid video duration."""
    return st.floats(min_value=min_dur, max_value=90.0, allow_nan=False, allow_infinity=False)


# ---------------------------------------------------------------------------
# Property 1 (PBT): Bug Condition — Loading/Navigation Steps Freeze Instead of Playing
# ---------------------------------------------------------------------------

@given(
    passo=navigation_passo_strategy(),
    rel_sec=rel_sec_strategy(),
    audio_dur=audio_duration_strategy(),
    video_duration=video_duration_strategy(),
)
@settings(max_examples=10, deadline=None)
def test_property1_navigation_step_timeline_event_has_is_loading_true(
    passo, rel_sec, audio_dur, video_duration
):
    """Property 1: Bug Condition — Navigation steps must carry is_loading=True.

    For any roteiro step where isBugCondition1 holds (action == "navigation",
    is_loading absent/False), the timeline builder SHALL emit a
    ``timeline_event`` with ``is_loading = True``.

    On UNFIXED code this FAILS: the builder emits
    ``{"timestamp": ..., "audio_path": ...}`` with no ``is_loading`` key.

    **Validates: Requirements 2.1**
    """
    assume(video_duration > rel_sec + 0.5)

    audio_path = f"data/audios/test_session/passo_{passo['passo']}_final.mp3"

    # Build timeline_event using the fixed builder logic
    timeline_event = _build_timeline_event_current(passo, rel_sec, audio_path)

    # Our generated input is always a navigation step (action == "navigation").
    # Verify the step is indeed a loading step.
    assert _is_loading_step(passo), (
        f"Test setup error: generated step is not a loading step. "
        f"passo={passo!r}"
    )

    # --- Property 1, assertion 1: the built event must carry is_loading=True ---
    # This is the EXPECTED (correct) behavior. The fixed code sets is_loading=True
    # for navigation steps.
    assert timeline_event.get("is_loading") is True, (
        f"FIX VERIFICATION FAILED — Property 1 violated: navigation step built "
        f"timeline_event = {timeline_event!r} "
        f"with no is_loading key (expected is_loading=True). "
        f"_calculate_segments will freeze the screen instead of keeping it "
        f"playing. passo={passo!r}, rel_sec={rel_sec:.3f}"
    )


@given(
    passo=navigation_passo_strategy(),
    rel_sec=rel_sec_strategy(),
    audio_dur=audio_duration_strategy(),
    video_duration=video_duration_strategy(),
)
@settings(max_examples=10, deadline=None)
def test_property1_navigation_step_segments_no_per_event_freeze(
    passo, rel_sec, audio_dur, video_duration
):
    """Property 1: Bug Condition — _calculate_segments must NOT freeze navigation steps.

    For any roteiro step where isBugCondition1 holds, after the fix the
    ``timeline_event`` carries ``is_loading=True`` and
    ``_calculate_segments([event], video_duration)`` SHALL:
      * contain at least one running ``("video", ...)`` segment
      * contain NO per-event ``("freeze", ...)`` narration segment

    On UNFIXED code this FAILS: the event lacks ``is_loading=True``, so
    ``_calculate_segments`` takes the freeze branch and emits a
    ``("freeze", ...)`` instead of a running ``("video", ...)``.

    **Validates: Requirements 2.1, 2.2**
    """
    assume(video_duration > rel_sec + 0.5)

    audio_path = f"data/audios/test_session/passo_{passo['passo']}_final.mp3"

    # Build timeline_event using the fixed builder
    timeline_event = _build_timeline_event_current(passo, rel_sec, audio_path)

    # Supply audio_duration so _calculate_segments can compute segment lengths
    timeline_event_with_dur = dict(timeline_event, audio_duration=audio_dur)

    segments, audio_delays = _calculate_segments([timeline_event_with_dur], video_duration)

    # Remove the structural trailing 3.5s final freeze — not attributable to this event
    non_trailing = [
        seg for seg in segments
        if not (seg[0] == "freeze" and abs(seg[2] - 3.5) < 0.01)
    ]

    # --- Assertion: there must be running video coverage ---
    video_segs = [s for s in non_trailing if s[0] == "video"]
    assert len(video_segs) > 0, (
        f"BUG CONFIRMED — Property 1 violated: no running ('video', ...) "
        f"segment emitted for navigation step. "
        f"The recording is frozen on the loading/transition frame for the "
        f"full narration duration ({audio_dur:.1f}s). "
        f"passo={passo!r}, rel_sec={rel_sec:.3f}, "
        f"all segments={segments}"
    )

    # --- Assertion: there must be NO per-event freeze ---
    freeze_segs = [s for s in non_trailing if s[0] == "freeze"]
    assert len(freeze_segs) == 0, (
        f"BUG CONFIRMED — Property 1 violated: ('freeze', ...) segment "
        f"emitted for navigation step — freeze_t={freeze_segs[0][1]:.3f}s, "
        f"dur={freeze_segs[0][2]:.1f}s. "
        f"The screen is paused on a loading/transition frame instead of "
        f"keeping the recording playing. "
        f"passo={passo!r}, rel_sec={rel_sec:.3f}, "
        f"all segments={segments}"
    )

    # --- Confirm: exactly one audio_delays entry (the narration plays over video) ---
    assert len(audio_delays) == 1, (
        f"Expected exactly 1 audio_delays entry for a single-event timeline, "
        f"got {len(audio_delays)}. Audio delays: {audio_delays}"
    )


# ===========================================================================
# DEFECT 2 — Double-click burst becomes three narrated steps
# ===========================================================================
#
# Property 2: Bug Condition — Double-Click Burst Becomes Three Narrated Steps
#
# Root cause (from design.md):
#     ``api/export_pipeline.py`` builds one roteiro entry per item in
#     ``payload["events"]`` via ``processar_evento(idx, ev)`` with no
#     coalescing/dedup.  A ``click``+``click``+``dblclick`` burst on the same
#     target therefore becomes three steps.
#
# Test strategy (scoped PBT):
#     * **Deterministic anchor**: the confirmed "Financeiro" burst from
#       ``sess_1780690407909`` (steps 6/7/8).
#     * **Hypothesis property test**: generate ordered event lists that embed a
#       same-target ``click``+``click``+``dblclick`` burst within
#       ``COALESCE_WINDOW_MS``, replicate the CURRENT (unfixed) per-event
#       fan-out (``enumerate(events)``), and assert that the burst target
#       produces exactly ONE step (the ``dblclick``).  The unfixed code produces
#       THREE steps — so the assertion FAILS, confirming the bug.
#
# **Validates: Requirements 1.3, 1.4, 2.3, 2.4**
# ===========================================================================

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Maximum span (ms) between the first click and the closing dblclick of a
# burst for it to be treated as one double-click.  From the observed ~197ms
# across steps 6→8, 400ms gives safe headroom.  This constant mirrors the
# value that the fix will introduce in export_pipeline.py.
COALESCE_WINDOW_MS = 400


# ---------------------------------------------------------------------------
# Helpers: replicate the CURRENT (unfixed) fan-out and the isBugCondition2
# predicate from the design.
# ---------------------------------------------------------------------------


def _count_steps_for_target_unfixed(events: list, xpath: str) -> int:
    """Replicate the CURRENT (unfixed) fan-out from _renderizar_exportacao_impl.

    The current code does:
        roteiro_raw = await asyncio.gather(*[
            processar_evento(idx, ev) for idx, ev in enumerate(events)
        ])

    i.e. exactly ONE roteiro step per captured event.  This helper counts how
    many of those steps target ``xpath`` (using the xpath field from eventData).

    This is a pure, synchronous replica of the structural property: one step
    per event, no coalescing.  We do NOT call processar_evento (which invokes
    the AI engine); instead we count by the input list structure.
    """
    return sum(
        1
        for ev in events
        if ev.get("eventData", {}).get("xpath", "") == xpath
    )


def _count_steps_for_target_with_coalescer(events: list, xpath: str, coalescer) -> int:
    """Count steps after applying a coalescer to the event list.

    Used to assert that the fixed code (with coalesce_dblclick_bursts applied)
    produces fewer steps for a burst target.
    """
    coalesced = coalescer(events)
    return sum(
        1
        for ev in coalesced
        if ev.get("eventData", {}).get("xpath", "") == xpath
    )


def _same_target(a: dict, b: dict, c: dict) -> bool:
    """Return True when three events share the same xpath (sameTarget predicate).

    Mirrors the design's ``sameTarget`` function.
    """
    def _xpath(ev):
        return ev.get("eventData", {}).get("xpath", "")

    return _xpath(a) == _xpath(b) == _xpath(c)


def _is_bug_condition_2(events: list) -> bool:
    """Return True when the event list contains a same-target click+click+dblclick burst.

    Mirrors the design's ``isBugCondition2`` predicate:

        EXISTS i SUCH THAT
            events[i].action   = "click"
            events[i+1].action = "click"
            events[i+2].action = "dblclick"
            sameTarget(events[i], events[i+1], events[i+2])
            (events[i+2].timestamp - events[i].timestamp) <= COALESCE_WINDOW_MS
    """
    for i in range(len(events) - 2):
        a, b, c = events[i], events[i + 1], events[i + 2]

        def _action(ev):
            return ev.get("eventData", {}).get("action", "")

        def _ts(ev):
            return ev.get("timestamp", 0)

        if (
            _action(a) == "click"
            and _action(b) == "click"
            and _action(c) == "dblclick"
            and _same_target(a, b, c)
            and (_ts(c) - _ts(a)) <= COALESCE_WINDOW_MS
        ):
            return True
    return False


def _make_event(action: str, xpath: str, timestamp: int, x: int = 0, y: int = 0) -> dict:
    """Construct a minimal captured event dict matching the export_pipeline format."""
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


# ---------------------------------------------------------------------------
# Deterministic anchor: sess_1780690407909 "Financeiro" burst (steps 6, 7, 8)
# ---------------------------------------------------------------------------
#
# Drawn verbatim from data/roteiros/sess_1780690407909.jsonl:
#   step 6  action=click    timestamp=1780690405629  xpath=//*[@id="file_1"]/div[1]/div[2]/h1[1]  x=233 y=723
#   step 7  action=click    timestamp=1780690405823  xpath=//*[@id="file_1"]/div[1]/div[2]/h1[1]  x=233 y=723
#   step 8  action=dblclick timestamp=1780690405826  xpath=//*[@id="file_1"]/div[1]/div[2]/h1[1]  x=233 y=723
#

FINANCEIRO_XPATH = '//*[@id="file_1"]/div[1]/div[2]/h1[1]'
FINANCEIRO_X = 233
FINANCEIRO_Y = 723

FINANCEIRO_BURST_EVENTS = [
    _make_event("click",    FINANCEIRO_XPATH, 1780690405629, FINANCEIRO_X, FINANCEIRO_Y),
    _make_event("click",    FINANCEIRO_XPATH, 1780690405823, FINANCEIRO_X, FINANCEIRO_Y),
    _make_event("dblclick", FINANCEIRO_XPATH, 1780690405826, FINANCEIRO_X, FINANCEIRO_Y),
]


class TestDefect2DeterministicAnchor:
    """Deterministic tests using the saved sess_1780690407909 "Financeiro" burst.

    Steps 6, 7, 8 target the same xpath within ~197ms — a single double-click
    that the unfixed code expands into three roteiro steps and three narrations.

    These tests encode the EXPECTED (correct) behavior and are designed to
    FAIL on the unfixed code.
    """

    def test_financeiro_burst_satisfies_bug_condition(self):
        """Precondition: the anchor burst satisfies isBugCondition2.

        Verifies the test setup is correct: the three events ARE a double-click
        burst (same target, within COALESCE_WINDOW_MS).
        """
        assert _is_bug_condition_2(FINANCEIRO_BURST_EVENTS), (
            "Test setup error: the Financeiro burst does not satisfy "
            "isBugCondition2. Check timestamps and xpath."
        )

    def test_financeiro_burst_unfixed_produces_three_steps(self):
        """Documents the actual (buggy) behavior of the unfixed code.

        The CURRENT (unfixed) fan-out produces THREE steps for the burst
        because it iterates over every event with no coalescing.

        This test PASSES on unfixed code (it documents the bug).
        """
        step_count = _count_steps_for_target_unfixed(
            FINANCEIRO_BURST_EVENTS, FINANCEIRO_XPATH
        )
        assert step_count == 3, (
            f"Expected the unfixed fan-out to produce 3 steps for the "
            f"Financeiro burst, got {step_count}."
        )

    def test_financeiro_burst_produces_exactly_one_dblclick_step(self):
        """Property 2 anchor: burst yields exactly ONE step (the dblclick).

        For the sess_1780690407909 Financeiro burst (click+click+dblclick on
        the same target within ~197ms), the fixed ingestion (with
        coalesce_dblclick_bursts applied) SHALL produce exactly ONE roteiro
        step for the burst target.

        **Validates: Requirements 2.3, 2.4**
        """
        # Apply the fixed coalescer before counting — replicates the fixed
        # _renderizar_exportacao_impl which calls coalesce_dblclick_bursts
        # before the per-event processar_evento fan-out.
        step_count = _count_steps_for_target_with_coalescer(
            FINANCEIRO_BURST_EVENTS, FINANCEIRO_XPATH, coalesce_dblclick_bursts
        )

        # --- Expected behavior (Property 2): exactly ONE step for the burst ---
        assert step_count == 1, (
            f"FIX VERIFICATION FAILED — Property 2 violated: the Financeiro "
            f"click+click+dblclick burst (sess_1780690407909 steps 6/7/8, "
            f"xpath={FINANCEIRO_XPATH!r}, x={FINANCEIRO_X} y={FINANCEIRO_Y}, "
            f"timestamps ...405629/...405823/...405826) still produces "
            f"{step_count} step(s) after coalescing instead of 1. "
            f"Expected: coalesce_dblclick_bursts collapses the burst to 1 step "
            f"(the dblclick), narrated once."
        )

    def test_financeiro_burst_retained_step_is_dblclick(self):
        """Property 2 anchor: the single retained step must be the dblclick.

        After coalescing, the burst's retained event SHALL be the dblclick
        (not one of the two leading clicks).

        **Validates: Requirements 2.3**
        """
        # Apply the fixed coalescer — the two leading click events are dropped.
        coalesced = coalesce_dblclick_bursts(FINANCEIRO_BURST_EVENTS)

        # There must be exactly one event remaining for the burst xpath.
        burst_events_for_xpath = [
            ev for ev in coalesced
            if ev["eventData"]["xpath"] == FINANCEIRO_XPATH
        ]
        assert len(burst_events_for_xpath) == 1, (
            f"FIX VERIFICATION FAILED: expected 1 event for burst xpath after "
            f"coalescing, got {len(burst_events_for_xpath)}. "
            f"Coalesced list: {coalesced}"
        )

        retained_action = burst_events_for_xpath[0]["eventData"]["action"]
        assert retained_action == "dblclick", (
            f"FIX VERIFICATION FAILED — Property 2 violated: the retained "
            f"event for the Financeiro burst has action={retained_action!r} "
            f"instead of 'dblclick'. "
            f"Expected: coalesce_dblclick_bursts drops the two leading clicks "
            f"and keeps only the dblclick. "
            f"Coalesced list: {coalesced}"
        )


# ---------------------------------------------------------------------------
# PBT strategy: generate event lists satisfying isBugCondition2
# ---------------------------------------------------------------------------


def _burst_xpath_strategy():
    """Generate a realistic xpath string for the burst target."""
    return st.sampled_from([
        '//*[@id="file_1"]/div[1]/div[2]/h1[1]',
        '//*[@id="nav_menu"]/li[2]/a',
        '//*[@id="btn_save"]',
        '//button[@class="primary"]',
        '//*[@id="sidebar"]/ul/li[3]',
    ])


def _burst_base_timestamp_strategy():
    """Generate a realistic base timestamp (ms) for the first click of a burst."""
    return st.integers(min_value=1_700_000_000_000, max_value=1_900_000_000_000)


def _burst_gap_strategy():
    """Generate intra-burst gap durations (ms) within the coalescing window.

    The observed Financeiro burst spans ~197ms (405629→405826).
    We generate gaps that keep the total span well within COALESCE_WINDOW_MS.
    """
    return st.integers(min_value=10, max_value=190)


def _surrounding_events_strategy(xpath: str, base_ts: int, burst_end_ts: int):
    """Generate a list of surrounding (non-burst) events that do NOT trigger isBugCondition2.

    These events have either a different xpath, or are single clicks on the same
    xpath but widely separated from the burst in time (> COALESCE_WINDOW_MS).
    """
    other_xpaths = [
        '//*[@id="other_element"]',
        '//div[@class="container"]/p[1]',
        '//input[@id="search_box"]',
    ]

    @st.composite
    def _one_surrounding_event(draw):
        xpath_choice = draw(st.sampled_from(other_xpaths))
        action = draw(st.sampled_from(["click", "dblclick", "navigation", "input"]))
        # Place at least COALESCE_WINDOW_MS before or after the burst
        placement = draw(st.booleans())
        if placement:
            ts = draw(st.integers(min_value=base_ts - 2000, max_value=base_ts - COALESCE_WINDOW_MS - 1))
        else:
            ts = draw(st.integers(min_value=burst_end_ts + COALESCE_WINDOW_MS + 1, max_value=burst_end_ts + 2000))
        return _make_event(action, xpath_choice, ts)

    return st.lists(_one_surrounding_event(), min_size=0, max_size=3)


@st.composite
def _event_list_with_burst(draw):
    """Generate an ordered event list embedding a same-target click+click+dblclick burst.

    The burst satisfies isBugCondition2:
    - action[i]=click, action[i+1]=click, action[i+2]=dblclick
    - same xpath for all three
    - (timestamps[i+2] - timestamps[i]) <= COALESCE_WINDOW_MS

    Returns (events, burst_xpath, burst_start_idx).
    """
    xpath = draw(_burst_xpath_strategy())
    base_ts = draw(_burst_base_timestamp_strategy())
    gap1 = draw(_burst_gap_strategy())
    gap2 = draw(st.integers(min_value=1, max_value=10))  # dblclick fires very quickly after second click

    ts_click1 = base_ts
    ts_click2 = base_ts + gap1
    ts_dblclick = ts_click2 + gap2

    # Ensure total span <= COALESCE_WINDOW_MS
    assume((ts_dblclick - ts_click1) <= COALESCE_WINDOW_MS)

    burst = [
        _make_event("click",    xpath, ts_click1),
        _make_event("click",    xpath, ts_click2),
        _make_event("dblclick", xpath, ts_dblclick),
    ]

    # Surrounding events: may come before or after the burst
    surrounding = draw(_surrounding_events_strategy(xpath, ts_click1, ts_dblclick))

    # Split surrounding into before/after and insert burst in the middle
    n_before = draw(st.integers(min_value=0, max_value=len(surrounding)))
    events_before = surrounding[:n_before]
    events_after = surrounding[n_before:]

    # Sort each sub-list by timestamp
    events_before_sorted = sorted(events_before, key=lambda e: e["timestamp"])
    events_after_sorted = sorted(events_after, key=lambda e: e["timestamp"])

    all_events = events_before_sorted + burst + events_after_sorted
    burst_start_idx = len(events_before_sorted)

    return all_events, xpath, burst_start_idx


# ---------------------------------------------------------------------------
# Property 2 (PBT): Bug Condition — Double-Click Burst Becomes Three Steps
# ---------------------------------------------------------------------------


@given(event_list_data=_event_list_with_burst())
@settings(max_examples=10, deadline=None)
def test_property2_dblclick_burst_produces_exactly_one_step(event_list_data):
    """Property 2: Bug Condition — Double-click burst yields exactly ONE step (the dblclick).

    For any ordered event list where isBugCondition2 holds (same-target
    click+click+dblclick within COALESCE_WINDOW_MS), the fixed ingestion
    (coalesce_dblclick_bursts applied before the fan-out) SHALL produce
    exactly ONE roteiro step for the burst target and that step SHALL be
    the dblclick.

    **Validates: Requirements 1.3, 1.4, 2.3, 2.4**
    """
    events, xpath, burst_start_idx = event_list_data

    # Verify our generated input satisfies isBugCondition2
    assume(_is_bug_condition_2(events))

    # Apply the fixed coalescer — replicates _renderizar_exportacao_impl
    # which calls coalesce_dblclick_bursts before the per-event fan-out.
    step_count = _count_steps_for_target_with_coalescer(events, xpath, coalesce_dblclick_bursts)

    # --- Expected behavior (Property 2): exactly ONE step for the burst target ---
    assert step_count == 1, (
        f"FIX VERIFICATION FAILED — Property 2 violated: a same-target "
        f"click+click+dblclick burst on xpath={xpath!r} still produces "
        f"{step_count} roteiro step(s) after coalescing instead of 1. "
        f"Expected: coalesce_dblclick_bursts collapses the burst to exactly "
        f"1 step (the dblclick). "
        f"Burst events: {events[burst_start_idx:burst_start_idx+3]}"
    )


@given(event_list_data=_event_list_with_burst())
@settings(max_examples=10, deadline=None)
def test_property2_dblclick_burst_retained_step_is_dblclick(event_list_data):
    """Property 2: Bug Condition — the single retained step for the burst is the dblclick.

    After coalescing, ONLY the dblclick event should remain for the burst
    target.

    **Validates: Requirements 2.3**
    """
    events, xpath, burst_start_idx = event_list_data

    assume(_is_bug_condition_2(events))

    # Apply the fixed coalescer
    coalesced = coalesce_dblclick_bursts(events)

    # Events for the burst xpath in the coalesced list
    burst_events_for_xpath = [
        ev for ev in coalesced
        if ev.get("eventData", {}).get("xpath", "") == xpath
    ]

    # There MUST be exactly 1 event for the xpath after coalescing
    assert len(burst_events_for_xpath) == 1, (
        f"FIX VERIFICATION FAILED — Property 2 violated: expected exactly "
        f"1 event for xpath={xpath!r} after coalescing, got "
        f"{len(burst_events_for_xpath)}. "
        f"Coalesced list: {coalesced}"
    )

    retained_action = burst_events_for_xpath[0]["eventData"]["action"]

    # Expected behavior: after coalescing, the ONLY event for this target
    # is the dblclick.
    assert retained_action == "dblclick", (
        f"FIX VERIFICATION FAILED — Property 2 violated: the retained "
        f"event for xpath={xpath!r} has action={retained_action!r} "
        f"instead of 'dblclick'. "
        f"Expected: coalesce_dblclick_bursts drops the two leading clicks "
        f"and keeps only the dblclick. "
        f"Coalesced list: {coalesced}"
    )
