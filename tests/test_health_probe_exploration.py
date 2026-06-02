"""Bug-condition exploration test — Health Probe Availability (Task 7).

Property 10: Bug Condition — Health Probe Availability
    _For any_ deploy/load-balancer probe where the bug condition holds because
    no health endpoint exists (C14), the fixed system SHALL expose
    ``GET /api/v1/health`` returning a successful health status for
    readiness/liveness checks.

**Validates: Requirements 1.14, 2.14**

This is a deterministic facet of the bug condition (``C14``): scope to the
single concrete failing case ``GET /api/v1/health``.

IMPORTANT — this test is written BEFORE the fix and is EXPECTED TO FAIL on the
unfixed code (the endpoint does not exist yet, so the route returns ``404``).
That failure is the SUCCESS case for the exploration phase: it confirms the bug
(C14) is real. The SAME test is re-run after task 13.4 lands the
``/api/v1/health`` endpoint, at which point it must PASS (fix checking).

Do NOT "fix" this test or the product code from here — the exploration phase
only documents the counterexample.
"""

from __future__ import annotations


def test_health_probe_returns_success_unauthenticated(client):
    """GET /api/v1/health must return 200 for readiness/liveness, no auth.

    On UNFIXED code the endpoint is absent, so FastAPI returns 404 and this
    assertion fails — confirming bug condition C14.
    """
    # No Authorization header: the probe is explicitly unauthenticated.
    response = client.get("/api/v1/health")

    assert response.status_code == 200, (
        "C14 counterexample: GET /api/v1/health returned "
        f"{response.status_code} (expected 200). The readiness/liveness probe "
        "endpoint does not exist on the unfixed backend."
    )

    body = response.json()
    assert isinstance(body, dict), f"Expected a JSON object health body, got {body!r}"
    # A successful health status is expected (design: returns {"status": "ok"}).
    assert body.get("status") == "ok", (
        f"Expected a successful health status payload, got {body!r}"
    )
