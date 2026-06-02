"""Bug-condition exploration test — Modo C Disabled (Task 8).

Property 11: Bug Condition — Modo C Disabled
    _For any_ capture submitted with ``modo_input == "C"`` where the bug
    condition holds (C15), the fixed system SHALL reject or disable the Modo C
    path (e.g. ``422``/``400`` or explicit "unsupported") until a documented,
    UI-supported, tested use case exists, while leaving Modo A and Modo B
    unaffected.

**Validates: Requirements 1.15, 2.15**

This is a deterministic facet of the bug condition (``C15``): scope to the
concrete failing case — ``POST /api/v1/capture/ingest`` with ``modo_input == "C"``
and a ``roteiro_manual`` payload. A small ``hypothesis`` strategy varies the
manual-script payload across the input space so the assertion holds for *any*
Modo C capture, not just one hand-picked body.

IMPORTANT — this test is written BEFORE the fix and is EXPECTED TO FAIL on the
unfixed code. On the unfixed backend, ``EventPayload.modo_input`` defaults to
``"A"`` and accepts ``"C"`` with no validation, so the ingest route returns
``200 {"status": "ok"}`` and schedules ``renderizar_exportacao`` — which then
executes the undocumented ``roteiro_manual`` branch
(``roteiro_enriquecido = payload["roteiro_manual"]`` in
``api/export_pipeline.py``). That acceptance is the C15 counterexample.

The failure here is the SUCCESS case for the exploration phase: it confirms the
bug (C15) is real. The SAME test is re-run after task 14.7 disables Modo C, at
which point it must PASS (fix checking).

Do NOT "fix" this test or the product code from here — the exploration phase
only documents the counterexample.
"""

from __future__ import annotations

from typing import Any, Dict, List

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st


def _is_rejected(response) -> bool:
    """True iff the response disables/rejects the Modo C path.

    A rejection is either an HTTP client error in the expected range
    (``400``/``422``) or a ``200`` whose body explicitly flags the mode as
    unsupported/disabled. Anything else (notably a plain ``200 {"status":
    "ok"}``) means Modo C was accepted and the undocumented branch will run.
    """
    if response.status_code in (400, 422):
        return True
    # Some implementations might choose to 200 with an explicit refusal marker.
    if response.status_code == 200:
        try:
            body = response.json()
        except ValueError:
            return False
        haystack = repr(body).lower()
        return any(
            marker in haystack
            for marker in ("unsupported", "disabled", "não suportado", "nao suportado")
        )
    return False


def _manual_step(i: int) -> Dict[str, Any]:
    return {
        "passo": i + 1,
        "timestamp": 1_000 * (i + 1),
        "intencao_original": f"Passo manual {i + 1}",
        "_simlink": {},
    }


# A roteiro_manual payload is a (possibly empty) list of manual-script steps.
roteiro_manual_strategy = st.lists(
    st.integers(min_value=0, max_value=20).map(_manual_step),
    min_size=0,
    max_size=8,
)


@settings(
    max_examples=8,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(roteiro_manual=roteiro_manual_strategy)
def test_modo_c_capture_is_rejected_or_disabled(client, roteiro_manual: List[Dict[str, Any]]):
    """Ingest with modo_input="C" must be rejected/disabled for any manual payload.

    On UNFIXED code the route accepts the payload (``200 {"status": "ok"}``) and
    schedules the undocumented Modo C branch, so ``_is_rejected`` is False and
    this assertion fails — confirming bug condition C15.
    """
    payload = {
        "session_id": "sess_modoc_exploration",
        "recording_start_time": 0,
        "events": [],
        # video_webm left empty on purpose: the bug is the *acceptance* of a
        # Modo C capture at the ingest boundary, observable from the response.
        "video_webm": "",
        "audio_instrutor_webm": "",
        "modo_input": "C",
        "roteiro_manual": roteiro_manual,
    }

    response = client.post("/api/v1/capture/ingest", json=payload)

    assert _is_rejected(response), (
        "C15 counterexample: ingest with modo_input='C' (roteiro_manual with "
        f"{len(roteiro_manual)} step(s)) returned {response.status_code} "
        f"body={response.text!r}. Expected the Modo C path to be rejected "
        "(422/400) or explicitly marked unsupported. The undocumented, "
        "untested roteiro_manual branch is reachable on the unfixed backend."
    )
