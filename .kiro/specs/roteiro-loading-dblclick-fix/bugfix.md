# Bugfix Requirements Document

## Introduction

After a prompt update and changes to roteiro construction and `time_bender`, the
user evaluated the most recently generated roteiro (session
`sess_1780690407909`) and its recorded video and reported two confirmed,
reproducible "should work but doesn't" defects.

**Defect 1 — Screen freezes during loading/navigation steps.** Keeping the
screen running (not frozen) while a page is loading is an explicit requirement,
implemented by the `freeze-frame-timing` spec. `video_eng/time_bender.py`
already honors this: in `_calculate_segments()`, when an event has
`is_loading=True` it keeps the recording running as `("video", ...)` segments
instead of emitting a `("freeze", ...)` segment. That logic is correct and
tested. The defect is that the `is_loading` flag is never populated by the
caller. In `api/rerender_pipeline.py` the `timeline_events` are built as
`{"timestamp": ..., "audio_path": ...}` with no `is_loading` key, so
`time_bender`'s `event.get('is_loading', False)` is always `False`. Every step —
including navigation/loading steps — goes through the freeze branch, and the
"loading-keeps-playing" logic is effectively dead code. In the latest roteiro,
steps 4, 5, and 9 have `"action": "navigation"` with loading-style narration
(e.g. step 5: "Estamos quase lá. A próxima navegação nos levará à seção de
documentos...") yet they are frozen instead of left playing.

**Defect 2 — A single double-click is narrated three times.** In the recording
the system narrated "Financeiro" three times for a single double-click; the user
expects ONE narration. A single user double-click fires the browser sequence
`click` + `click` + `dblclick`. The capture extension
`extension/content_scripts/radar_v3.js` binds and forwards `click` and
`dblclick` separately, and `api/export_pipeline.py` creates one roteiro step per
captured event with no coalescing/dedup. In the latest roteiro, steps 6, 7, and
8 target the same element (`target_text` "Financeiro", same xpath
`//*[@id="file_1"]/div[1]/div[2]/h1[1]`, same coordinates x=233, y=723) within
~200ms (timestamps ...405629, ...405823, ...405826): step 6 `action=click`, step
7 `action=click`, step 8 `action=dblclick`. One user action becomes three
narrated steps.

This bugfix is scoped to (a) propagating loading/navigation classification into
the timeline so the existing keep-playing logic activates, and (b) coalescing
the click+click+dblclick burst on the same target into a single step. It must
not break the existing `freeze-frame-timing` behavior.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a roteiro step is a loading/navigation step (e.g. `action == "navigation"` or a loading-type micro-narração) THEN the system builds its `timeline_events` entry in `api/rerender_pipeline.py` without an `is_loading` key, so the event reaches `time_bender` with `is_loading` effectively `False`.

1.2 WHEN `time_bender._calculate_segments()` processes a loading/navigation step that arrived without `is_loading=True` THEN the system takes the freeze branch and pauses the screen on a loading/transition frame for the duration of the narration instead of keeping the recording playing.

1.3 WHEN a single user double-click is captured (browser sequence `click` + `click` + `dblclick` on the same target within a short time window) THEN the system forwards each event separately and `api/export_pipeline.py` creates one roteiro step per event, producing multiple steps for one user action.

1.4 WHEN multiple steps are produced for a single double-click THEN the system narrates the same target multiple times (e.g. "Financeiro" narrated three times across steps 6, 7, and 8 for one double-click).

### Expected Behavior (Correct)

2.1 WHEN a roteiro step is a loading/navigation step THEN the system SHALL classify it and propagate `is_loading=True` into the `timeline_events` entry consumed by `time_bender`.

2.2 WHEN `time_bender._calculate_segments()` processes a loading/navigation step carrying `is_loading=True` THEN the system SHALL keep the recording running (emit `("video", ...)` segments) for the duration of the narration instead of freezing.

2.3 WHEN a single user double-click is captured as a `click` + `click` + `dblclick` burst on the same target within a short time window THEN the system SHALL coalesce the burst into a SINGLE roteiro step representing the double-click.

2.4 WHEN a double-click burst has been coalesced into a single step THEN the system SHALL narrate that target exactly once.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a timeline event is a normal (non-loading) click step THEN the system SHALL CONTINUE TO insert one freeze frame per event whose duration matches that event's TTS audio duration, plus the trailing final freeze frame, exactly as the `freeze-frame-timing` spec defines.

3.2 WHEN an event already carries `is_loading=True` from any caller THEN the system SHALL CONTINUE TO keep the recording playing in `time_bender`, with identical results in both the FFmpeg path and the MoviePy fallback.

3.3 WHEN distinct user interactions occur on different targets (or on the same target but separated beyond the coalescing time window) THEN the system SHALL CONTINUE TO produce one roteiro step per distinct interaction with its own narration.

3.4 WHEN a user performs a single (non-double) click on a target THEN the system SHALL CONTINUE TO produce exactly one roteiro step narrated once.

3.5 WHEN input/change/scroll/navigation events are captured THEN the system SHALL CONTINUE TO be forwarded and ingested as today, except for the loading classification (2.1) and the double-click coalescing (2.3).

3.6 WHEN the roteiro/timeline contains no loading steps and no double-click bursts THEN the system SHALL CONTINUE TO produce the same number of steps, timeline events, and narrations as before this fix.

## Deriving the Bug Conditions

### Defect 1 — Loading steps must keep playing

**Bug Condition Function** — identifies events that should keep playing but are frozen:

```pascal
FUNCTION isBugCondition1(step)
  INPUT: step of type RoteiroStep (as assembled into a timeline_event)
  OUTPUT: boolean

  // A loading/navigation step that reaches time_bender without is_loading=True
  RETURN isLoadingStep(step) AND (step.is_loading is absent OR step.is_loading = false)
END FUNCTION

FUNCTION isLoadingStep(step)
  // Caller-side classification responsibility
  RETURN step.action = "navigation" OR isLoadingNarration(step.micro_narracao)
END FUNCTION
```

**Property Specification (Fix Checking):**

```pascal
// Property: loading/navigation steps keep the screen playing
FOR ALL step WHERE isBugCondition1(step) DO
  event   ← buildTimelineEvent'(step)   // F' = fixed builder in rerender_pipeline
  ASSERT event.is_loading = true
  segments ← time_bender._calculate_segments([event], video_duration)
  ASSERT segments_for(event) contains a ("video", ...) running segment
     AND segments_for(event) contains NO ("freeze", ...) segment for that narration
END FOR
```

### Defect 2 — Double-click narrated once

**Bug Condition Function** — identifies a click+click+dblclick burst on one target:

```pascal
FUNCTION isBugCondition2(events)
  INPUT: events = ordered list of captured interaction events
  OUTPUT: boolean

  // True when a sub-sequence is a double-click burst on the same target
  RETURN EXISTS i SUCH THAT
       events[i].action   = "click"
   AND events[i+1].action = "click"
   AND events[i+2].action = "dblclick"
   AND sameTarget(events[i], events[i+1], events[i+2])
   AND (events[i+2].timestamp - events[i].timestamp) <= COALESCE_WINDOW_MS
END FUNCTION

FUNCTION sameTarget(a, b, c)
  RETURN a.xpath = b.xpath = c.xpath
     AND a.coordinates ≈ b.coordinates ≈ c.coordinates
END FUNCTION
```

**Property Specification (Fix Checking):**

```pascal
// Property: a double-click burst becomes exactly one narrated step
FOR ALL events WHERE isBugCondition2(events) DO
  roteiro ← buildRoteiro'(events)   // F' = fixed ingestion (radar_v3.js and/or export_pipeline)
  burst   ← the click+click+dblclick sub-sequence on the same target
  ASSERT count_steps_for(roteiro, burst) = 1
  ASSERT the single retained step is the dblclick
  ASSERT count_narrations_for(roteiro, burst.target) = 1
END FOR
```

### Preservation Goal (both defects)

```pascal
// Property: Preservation Checking
// F  = original (unfixed) functions: build_timeline_events, build_roteiro
// F' = fixed functions
FOR ALL X WHERE NOT isBugCondition1(X) AND NOT isBugCondition2(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

This ensures normal click steps still freeze as before, events already flagged
`is_loading=True` are unchanged, and distinct interactions still produce one step
each — the fixed code behaves identically to the original for all non-buggy
inputs.
