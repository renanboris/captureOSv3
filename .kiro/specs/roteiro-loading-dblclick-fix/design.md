# Roteiro Loading/Double-Click Fix — Bugfix Design

## Overview

This bugfix addresses two confirmed, reproducible defects observed in the most
recently generated roteiro (session `sess_1780690407909`) and its rendered
video. Both are "should work but doesn't" defects: the desired behavior is
already specified and partially implemented, but a missing piece of plumbing
prevents it from activating.

**Defect 1 — Loading/navigation steps freeze instead of staying live.** Keeping
the screen running while a page is loading is an explicit requirement
implemented by the `freeze-frame-timing` spec. `video_eng/time_bender.py`
already honors it: `_calculate_segments()` emits a running `("video", ...)`
segment (no `("freeze", ...)`) whenever an event carries `is_loading=True`. That
logic is correct and tested. The problem is that the flag is never populated.
`api/rerender_pipeline.py` builds each `timeline_events` entry as
`{"timestamp": ..., "audio_path": ...}` with no `is_loading` key, so
`time_bender`'s `event.get('is_loading', False)` is always `False`. Every step —
including `action == "navigation"` loading steps — takes the freeze branch, and
the keep-playing path is effectively dead code. The fix classifies
loading/navigation steps when building the timeline and propagates
`is_loading=True`, activating the existing logic.

**Defect 2 — A single double-click is narrated three times.** A single user
double-click fires the browser sequence `click` + `click` + `dblclick` on the
same target. `extension/content_scripts/radar_v3.js` forwards each event
separately, and `api/export_pipeline.py` creates one roteiro step per captured
event with no coalescing/dedup. For `sess_1780690407909`, steps 6, 7, and 8 all
target "Financeiro" (same xpath `//*[@id="file_1"]/div[1]/div[2]/h1[1]`, same
coordinates x=233 y=723) within ~200ms — one user action became three narrated
steps. The fix coalesces a same-target `click` + `click` + `dblclick` burst that
falls inside a short time window into a single step (the `dblclick`), narrated
once.

The fix is intentionally minimal and surgical. It must not alter the existing
`freeze-frame-timing` behavior: normal click steps must still freeze, events
already flagged `is_loading=True` must behave identically, and distinct
interactions must still produce one step each.

## Glossary

- **Bug_Condition (C)**: A predicate over an input that identifies the buggy
  case. There are two: `isBugCondition1` (a loading/navigation step that reaches
  `time_bender` without `is_loading=True`) and `isBugCondition2` (a same-target
  `click`+`click`+`dblclick` burst inside the coalescing window).
- **Property (P)**: The desired behavior for inputs satisfying a bug condition —
  loading steps keep the screen playing (Defect 1); a double-click burst becomes
  exactly one step narrated once (Defect 2).
- **Preservation**: Existing behavior that must remain byte-for-byte identical
  for all inputs that satisfy neither bug condition (`F(X) = F'(X)` for
  `¬C₁(X) ∧ ¬C₂(X)`).
- **F / F'**: The original (unfixed) functions vs. the fixed functions.
- **Roteiro step**: An enriched dict in the `roteiro` list. Per the saved JSONL,
  the interaction kind lives at `step["_simlink"]["action"]` (values include
  `click`, `dblclick`, `navigation`), and narration lives at `step["ancora"]`
  and `step["micro_narracao"]`. Top-level keys include `passo`, `timestamp`,
  `intencao_original`.
- **Captured event**: A raw item in `payload["events"]` consumed by
  `api/export_pipeline.py`. Each has `ev["timestamp"]` and
  `ev["eventData"]["action"]` plus target descriptors (`xpath`, `css_selector`,
  `target_geometry`, `target_text`).
- **timeline_event**: A dict consumed by `time_bender`. Today:
  `{"timestamp": rel_sec, "audio_path": ...}`. After the fix, loading steps also
  carry `"is_loading": True`.
- **`_calculate_segments`**: The shared timing rule in `video_eng/time_bender.py`
  used by both the FFmpeg path and the MoviePy fallback. Already branches on
  `is_loading`; not modified by this fix.
- **`isLoadingStep`**: Caller-side classifier — true when
  `step["_simlink"]["action"] == "navigation"` (or the step exhibits
  loading-style narration).
- **COALESCE_WINDOW_MS**: The maximum span between the first `click` and the
  closing `dblclick` of a burst for it to be treated as one double-click. From
  the observed data (~197ms across steps 6→8) a value of 400ms gives safe
  headroom; the exact constant is a tuning detail set during implementation.

## Bug Details

### Bug Condition

There are two independent bug conditions; an input may trigger either.

**Defect 1.** The bug manifests when a loading/navigation step is built into a
`timeline_event` without `is_loading=True`. `rerender_pipeline.py` never sets the
flag, so every loading step reaches `time_bender` looking like a normal click and
is frozen instead of left playing.

**Defect 2.** The bug manifests when a single user double-click is captured as a
`click` + `click` + `dblclick` burst on the same target within a short window.
Each event becomes its own roteiro step, so one action is narrated up to three
times.

**Formal Specification:**
```
FUNCTION isBugCondition1(step)
  INPUT: step of type RoteiroStep (as assembled into a timeline_event)
  OUTPUT: boolean

  // A loading/navigation step that reaches time_bender without is_loading=True
  RETURN isLoadingStep(step)
         AND (step.is_loading is absent OR step.is_loading = false)
END FUNCTION

FUNCTION isLoadingStep(step)
  // Caller-side classification responsibility (rerender_pipeline)
  RETURN step._simlink.action = "navigation"
         OR isLoadingNarration(step.micro_narracao)
END FUNCTION

FUNCTION isBugCondition2(events)
  INPUT: events = ordered list of captured interaction events
  OUTPUT: boolean

  RETURN EXISTS i SUCH THAT
       events[i].action     = "click"
   AND events[i+1].action   = "click"
   AND events[i+2].action   = "dblclick"
   AND sameTarget(events[i], events[i+1], events[i+2])
   AND (events[i+2].timestamp - events[i].timestamp) <= COALESCE_WINDOW_MS
END FUNCTION

FUNCTION sameTarget(a, b, c)
  RETURN a.xpath = b.xpath = c.xpath
     AND a.coordinates ≈ b.coordinates ≈ c.coordinates
END FUNCTION
```

### Examples

Drawn from the saved roteiro `data/roteiros/sess_1780690407909.jsonl`:

- **Defect 1 — step 5 (navigation):** `action == "navigation"`, narration
  "Estamos quase lá. A próxima navegação nos levará à seção de documentos...".
  Expected: screen keeps playing during narration. Actual: frozen on the
  transition frame because the timeline_event had no `is_loading` flag.
- **Defect 1 — steps 4 and 9 (navigation):** same shape, both frozen instead of
  left running.
- **Defect 2 — steps 6, 7, 8 ("Financeiro"):** step 6 `action=click`
  (ts ...405629), step 7 `action=click` (ts ...405823), step 8 `action=dblclick`
  (ts ...405826), identical xpath/coordinates. Expected: ONE step narrated once.
  Actual: three steps, "Financeiro" narrated three times.
- **Edge — non-burst repeats:** the older session `sess_1780494057872` shows
  steps 6/7/8 on "Recursos Humanos" with `click`/`click`/`dblclick` too;
  coalescing must collapse only when the same-target + within-window condition
  holds, and otherwise leave the sequence alone.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Normal (non-loading) click steps must continue to produce exactly one freeze
  frame per event whose duration matches that event's TTS audio duration, plus
  the trailing final 3.5s freeze — exactly as `freeze-frame-timing` defines.
- Events that already carry `is_loading=True` from any caller must continue to
  keep the recording playing, with identical results in both the FFmpeg path and
  the MoviePy fallback (`_calculate_segments` is the single shared rule and is
  not modified).
- Distinct user interactions — different targets, or the same target separated
  beyond the coalescing window — must continue to produce one roteiro step each
  with its own narration.
- A single (non-double) click must continue to produce exactly one step narrated
  once.
- `input` / `change` / `scroll` / `navigation` events must continue to be
  forwarded and ingested as today, except for the new loading classification and
  double-click coalescing.
- When the roteiro/timeline contains no loading steps and no double-click bursts,
  the system must produce the same number of steps, timeline events, and
  narrations as before this fix.

**Scope:**
All inputs that satisfy neither `isBugCondition1` nor `isBugCondition2` must be
completely unaffected by this fix. This includes:
- Non-loading click steps (the freeze path is untouched).
- Timeline events already flagged `is_loading=True`.
- Mouse clicks on distinct targets, lone single clicks, typing/scroll/change
  events, and navigation events that are not part of a double-click burst.

The actual expected correct behavior for buggy inputs is defined in the
Correctness Properties section (Property 1 and Property 3).

## Hypothesized Root Cause

Based on the bug analysis and the source as read:

1. **Missing flag propagation in the timeline builder (Defect 1, primary).**
   In `api/rerender_pipeline.py`, the loop that builds `timeline_events` appends
   `{"timestamp": task_info["rel_sec"], "audio_path": task_info["audio_path"]}`
   with no `is_loading` key. `time_bender._calculate_segments()` reads
   `event.get('is_loading', False)`, which is therefore always `False`. The
   keep-playing branch never runs. This is confirmed by reading both files.

2. **No caller-side loading classifier (Defect 1, secondary).** The pipeline has
   the data needed to classify a loading step — `passo["_simlink"]["action"]`
   equals `"navigation"` for loading steps in the saved roteiros — but no code
   maps that into the per-event TTS task or the timeline_event.

3. **No coalescing of the double-click burst (Defect 2, primary).**
   `api/export_pipeline.py` builds one roteiro entry per item in
   `payload["events"]` via `processar_evento(idx, ev)` with no dedup. A
   `click`+`click`+`dblclick` burst on the same target therefore becomes three
   steps. Confirmed by reading `_renderizar_exportacao_impl`.

4. **Forwarding fans out the burst (Defect 2, contributing).**
   `extension/content_scripts/radar_v3.js` binds `click` and `dblclick`
   independently (`document.addEventListener('click', ...)` and
   `document.addEventListener('dblclick', ...)`) and forwards each via
   `user_interaction`, so all three browser events reach the backend. Coalescing
   can be done at ingestion (server-side, deterministic and testable) and/or at
   the source; this design places the authoritative coalescing server-side.

## Correctness Properties

Property 1: Bug Condition (Defect 1) — Loading/navigation steps keep playing

_For any_ roteiro step where the bug condition holds (`isBugCondition1` returns
true: the step is a loading/navigation step that would otherwise reach
`time_bender` without `is_loading=True`), the fixed timeline builder SHALL emit a
`timeline_event` with `is_loading = True`, AND `_calculate_segments` for that
event SHALL contain a running `("video", ...)` segment and NO per-event
`("freeze", ...)` narration segment.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition (Defect 2) — Double-click burst becomes one narrated step

_For any_ captured event list where the bug condition holds (`isBugCondition2`
returns true: a same-target `click`+`click`+`dblclick` burst within
`COALESCE_WINDOW_MS`), the fixed ingestion SHALL coalesce the burst into exactly
ONE roteiro step, the retained step SHALL be the `dblclick`, and that target
SHALL be narrated exactly once (one TTS task / one timeline_event for the burst).

**Validates: Requirements 2.3, 2.4**

Property 3: Preservation — Non-buggy inputs are unchanged

_For any_ input where NEITHER bug condition holds (`isBugCondition1` is false AND
`isBugCondition2` is false), the fixed functions SHALL produce exactly the same
result as the original functions (`F(X) = F'(X)`), preserving: per-event freeze
structure for non-loading click timelines (one freeze per event with matching
duration plus the trailing 3.5s freeze), identical behavior for events already
flagged `is_loading=True` across both the FFmpeg and MoviePy paths, identity of
the coalescer for event lists with no qualifying burst (distinct targets, lone
clicks, out-of-window repeats, and `input`/`change`/`scroll`/`navigation`
events), and identical step/timeline/narration counts.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct, the fix touches two backend files
(authoritative) and optionally the capture extension.

**File 1**: `api/rerender_pipeline.py` — propagate loading classification

**Function**: the timeline-building loop in
`rerenderizar_com_roteiro_aprovado`

**Specific Changes**:
1. **Add a loading classifier helper**: `is_loading_step(passo) -> bool` that
   returns `True` when `passo.get("_simlink", {}).get("action") == "navigation"`
   (and, optionally, when `micro_narracao` matches a loading-narration pattern).
   Keep the predicate pure and side-effect free so it is directly testable.
2. **Carry the flag through the TTS task**: when assembling each `tts_tasks`
   entry, record `"is_loading": is_loading_step(passo)` alongside `texto`,
   `audio_path`, `rel_sec`.
3. **Set the flag on the timeline_event**: in the loop that appends to
   `timeline_events` for successful TTS, include
   `"is_loading": task_info["is_loading"]`. For non-loading steps, omit the key
   or set it `False` so `_calculate_segments` is byte-for-byte unchanged for them.
4. **No change to `time_bender`**: `_calculate_segments`,
   `compose_video_with_freeze_frames`, and the MoviePy fallback already read
   `is_loading` and are correct. Leaving them untouched guarantees Property 3 for
   the timing path.

**File 2**: `api/export_pipeline.py` — coalesce the double-click burst

**Function**: `_renderizar_exportacao_impl`, at the point where
`events = payload.get("events", [])` is read (before the per-event
`processar_evento` fan-out).

**Specific Changes**:
1. **Add a pure coalescing function**:
   `coalesce_dblclick_bursts(events, window_ms=COALESCE_WINDOW_MS) -> list`.
   Scan the ordered list; when a `click` + `click` + `dblclick` run targets the
   same element (matching `eventData.xpath` and approximately equal
   `target_geometry`) and the span between the first `click` and the `dblclick`
   is `<= window_ms`, drop the two leading `click` events and keep only the
   `dblclick`. Leave every other event untouched and in order.
2. **Apply before enrichment**: replace `events` with
   `coalesce_dblclick_bursts(events)` so the downstream `processar_evento`
   fan-out, enrichment, TTS, and timeline all see one step for the burst —
   yielding one narration (Property 2.4) automatically.
3. **Define `COALESCE_WINDOW_MS` and `sameTarget`**: a module-level constant
   (e.g. 400ms) and a helper comparing xpath plus geometry within a small pixel
   tolerance. Keep both functions pure for property-based testing.
4. **Preserve identity for non-bursts**: the coalescer must return the input list
   unchanged whenever no qualifying burst exists (different targets, out-of-window
   spacing, lone clicks, non-click events) to satisfy Property 3.

**File 3 (optional, defense-in-depth)**: `extension/content_scripts/radar_v3.js`

The authoritative coalescing is server-side. If source-side suppression is also
desired, the click/dblclick listeners could buffer same-target clicks briefly and
forward only the `dblclick`. This is optional and must not change forwarding of
any other event type (Requirement 3.5); the server-side coalescer remains the
tested guarantee.

## Testing Strategy

### Validation Approach

Two phases. First, write exploratory tests that surface counterexamples on the
UNFIXED code to confirm the root-cause hypotheses (loading steps reach
`time_bender` without `is_loading`; a burst becomes three steps). Then verify the
fix produces the correct behavior for buggy inputs (fix checking) and leaves all
non-buggy inputs unchanged (preservation checking). Property-based tests use
Hypothesis, matching the existing suite under `tests/` (e.g.
`test_preservation_freeze_frame_timing.py`).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each defect BEFORE
implementing the fix, confirming or refuting the root-cause analysis. If refuted,
re-hypothesize.

**Test Plan**: For Defect 1, build a `timeline_events` list from a roteiro whose
step is `action == "navigation"` using the CURRENT builder, and assert (it will
fail / reveal) that the event has no `is_loading=True` and that
`_calculate_segments` emits a `("freeze", ...)` for it. For Defect 2, run the
CURRENT ingestion over the `sess_1780690407909` events (steps 6/7/8) and assert it
produces three steps for the "Financeiro" target.

**Test Cases**:
1. **Navigation-step freeze (Defect 1)**: a navigation step yields a frozen
   segment under the current builder (will fail to keep playing on unfixed code).
2. **Loading-narration freeze (Defect 1)**: a step with loading-style narration
   is frozen under the current builder (will fail on unfixed code).
3. **Triple narration (Defect 2)**: the `click`+`click`+`dblclick` "Financeiro"
   burst produces three steps under the current ingestion (will fail / show 3 on
   unfixed code).
4. **Edge — out-of-window repeat**: same-target clicks spaced beyond the window
   are NOT a double-click and should remain separate (clarifies the boundary;
   may behave the same before and after).

**Expected Counterexamples**:
- A navigation `timeline_event` lacking `is_loading=True`, frozen by
  `_calculate_segments`.
- Three roteiro steps (and three narrations) for one double-click target.
- Likely causes: missing flag propagation (Defect 1), missing coalescing
  (Defect 2).

### Fix Checking

**Goal**: Verify that for all inputs where a bug condition holds, the fixed
functions produce the expected behavior.

**Pseudocode:**
```
// Defect 1
FOR ALL step WHERE isBugCondition1(step) DO
  event    := buildTimelineEvent_fixed(step)
  ASSERT event.is_loading = true
  segments := time_bender._calculate_segments([event], video_duration)
  ASSERT segments_for(event) contains a ("video", ...) running segment
     AND segments_for(event) contains NO ("freeze", ...) narration segment for it
END FOR

// Defect 2
FOR ALL events WHERE isBugCondition2(events) DO
  out := coalesce_dblclick_bursts_fixed(events)
  burst := the click+click+dblclick sub-sequence on the same target
  ASSERT count_steps_for(out, burst) = 1
  ASSERT the single retained event is the dblclick
  ASSERT count_narrations_for(roteiro_from(out), burst.target) = 1
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where neither bug condition holds, the fixed
functions produce the same result as the original functions.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition1(X) AND NOT isBugCondition2(X) DO
  ASSERT buildTimelineEvent_original(X) = buildTimelineEvent_fixed(X)
  ASSERT coalesce_dblclick_bursts_fixed(X.events) = X.events   // identity
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation
because it generates many inputs across the domain, catches edge cases manual
tests miss, and gives strong guarantees that behavior is unchanged for all
non-buggy inputs. The existing observation-first tests in
`tests/test_preservation_freeze_frame_timing.py` already pin the
`_calculate_segments` structure and remain authoritative for the timing path.

**Test Plan**: Observe behavior on UNFIXED code for non-loading click timelines,
pre-flagged loading events, and non-burst event lists; then write property tests
asserting the fixed code matches.

**Test Cases**:
1. **Non-loading freeze structure**: for generated non-loading timelines, one
   freeze per event (matching duration) plus the trailing 3.5s freeze is
   unchanged (reuse/extend existing freeze-frame preservation tests).
2. **Pre-flagged loading transparency**: events already carrying
   `is_loading=True` produce identical `_calculate_segments` output before and
   after the fix.
3. **Coalescer identity on non-bursts**: for event lists with distinct targets,
   out-of-window spacing, lone clicks, or only `input`/`change`/`scroll`/
   `navigation` events, `coalesce_dblclick_bursts(events) == events`.
4. **Single-click preservation**: a lone click yields exactly one step narrated
   once.

### Unit Tests

- `is_loading_step`: returns `True` for `_simlink.action == "navigation"`,
  `False` for `click`/`dblclick`; loading-narration detection (if implemented).
- Timeline builder: a navigation step yields a timeline_event with
  `is_loading=True`; a click step yields one without the flag (or `False`).
- `coalesce_dblclick_bursts`: the `sess_1780690407909` "Financeiro" burst →
  single `dblclick` step; out-of-window and different-target sequences unchanged.
- `_calculate_segments` regression: a single `is_loading=True` event produces a
  running `("video", ...)` segment and no per-event freeze (guards the activated
  path).

### Property-Based Tests

- **Property 1**: generate roteiro steps with random actions/narrations; assert
  loading steps build `is_loading=True` and produce running segments, while
  non-loading steps build without the flag.
- **Property 2**: generate event lists with an embedded same-target
  `click`+`click`+`dblclick` burst within the window (random surrounding events);
  assert exactly one retained step (the dblclick) and one narration for the
  target.
- **Property 3**: generate inputs satisfying neither bug condition; assert
  `F(X) = F'(X)` for both the timeline builder and the coalescer (identity), and
  reuse the existing freeze-frame structural preservation properties.

### Integration Tests

- End-to-end timeline build from a saved roteiro containing navigation steps:
  the resulting `timeline_events` carry `is_loading=True` for those steps and the
  composed segment plan keeps them playing.
- Full ingestion over `sess_1780690407909`-style events: a single double-click
  burst yields one step and one narration, while distinct interactions in the
  same session still yield one step each.
- Mixed flow (loading steps + a double-click burst + normal clicks): loading
  steps play, the burst collapses to one narration, and normal click steps still
  freeze exactly as before — confirming no regression to `freeze-frame-timing`.
