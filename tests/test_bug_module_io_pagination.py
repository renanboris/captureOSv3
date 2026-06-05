"""Bug-condition exploration tests — Property 5 (Non-Blocking Module I/O + Pagination).

Spec: production-hardening (bugfix). Task 3 / design.md Property 5.

These tests encode the *corrected* behavior for Property 5 and therefore MUST
FAIL on the current (unfixed) code — a failure here CONFIRMS the bug exists.
DO NOT "fix" these tests or the product code to make them pass; the same tests
are re-run unchanged after the Phase 1 fix (task 14.6) where they must PASS.

Bug condition C(X) for this property (design.md → Bug Details):

  C8(X): a call to ``GET /api/v1/modulos`` (or ``POST /api/v1/simlink/{id}/conclusao``)
         runs a synchronous ``glob.glob("data/simlink/*.json")`` scan inside an
         async route — blocking the event loop, performing an O(n) file scan on
         every request, with no pagination.

isBugCondition(X) = C8(X)

The corrected handler (Property 5) SHALL:
  * accept pagination parameters (``limit`` / ``offset``) on ``GET /api/v1/modulos``
    and return the matching page of module data for any filter/page, and
  * perform the module lookup via offloaded/async I/O (e.g. ``asyncio.to_thread``)
    so the synchronous scan does not block the event loop.

**Validates: Requirements 1.8, 2.8**
"""

from __future__ import annotations

import inspect
import json
import re
import sys
import types
import uuid

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

# --------------------------------------------------------------------------- #
# C7 isolation shim (unrelated defect)
# --------------------------------------------------------------------------- #
# C8 is about pagination / blocking I/O. It is independent of C7, the *separate*
# defect (fixed in task 13.1) that leaves ``static_ffmpeg`` unlisted in
# requirements.txt, which makes ``api.main`` un-importable on a clean checkout.
# Without this guard, the conftest ``app``/``client`` fixtures would ``pytest.skip``
# on the C7 ImportError and the C8 counterexample would be *masked* (an
# inconclusive skip) instead of surfaced as the required failure. Install a
# no-op shim ONLY when ``static_ffmpeg`` is genuinely absent, so that once C7 is
# fixed the real package is used unchanged.
try:  # pragma: no cover - environment dependent
    import static_ffmpeg  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover - environment dependent
    _stub = types.ModuleType("static_ffmpeg")
    _stub.add_paths = lambda *args, **kwargs: None
    sys.modules["static_ffmpeg"] = _stub

from api import main as api_main  # noqa: E402  (import after the C7 shim)


# --------------------------------------------------------------------------- #
# C8 (static) — GET /api/v1/modulos must accept pagination parameters
# --------------------------------------------------------------------------- #
def test_c8_listar_modulos_accepts_pagination_params():
    """C8: ``listar_modulos`` must expose ``limit`` / ``offset`` pagination params.

    EXPECTED ON UNFIXED CODE: FAILS — the handler signature is
    ``listar_modulos(dominio: str = "")`` with no pagination parameters, so the
    full collection is always scanned and returned.
    """
    params = set(inspect.signature(api_main.listar_modulos).parameters)
    paginates = {"limit", "offset"} <= params or {"page", "page_size"} <= params

    assert paginates, (
        "C8 counterexample: GET /api/v1/modulos does not support pagination — "
        f"listar_modulos parameters are {sorted(params)!r} (no limit/offset or "
        "page/page_size). Every request returns the full collection."
    )


# --------------------------------------------------------------------------- #
# C8 (static) — the module scan must be offloaded off the event loop
# --------------------------------------------------------------------------- #
def test_c8_module_listing_is_offloaded_not_blocking():
    """C8: the ``glob`` + file-read scan must be offloaded so it does not block
    the async event loop.

    EXPECTED ON UNFIXED CODE: FAILS — ``listar_modulos`` calls
    ``glob.glob("data/simlink/*.json")`` and ``open(...)`` synchronously inside
    the ``async def`` route, blocking the event loop on every request.
    """
    src = inspect.getsource(api_main.listar_modulos)

    offloads = any(
        token in src
        for token in ("asyncio.to_thread", "run_in_executor", "aiofiles", "anyio.to_thread")
    )
    has_blocking_glob = re.search(r"glob\.glob\s*\(", src) is not None

    assert offloads, (
        "C8 counterexample: listar_modulos performs a synchronous scan on the "
        f"event loop (glob.glob present: {has_blocking_glob}) with no offload "
        "primitive (asyncio.to_thread / run_in_executor / aiofiles). The O(n) "
        "file scan blocks the async route on every request."
    )


# --------------------------------------------------------------------------- #
# C8 (property) — pagination must return the correct page of module data
# --------------------------------------------------------------------------- #
@st.composite
def _pagination_case(draw):
    """Generate a module count plus a (limit, offset) window over it."""
    n_modules = draw(st.integers(min_value=1, max_value=8))
    limit = draw(st.integers(min_value=1, max_value=n_modules + 2))
    offset = draw(st.integers(min_value=0, max_value=n_modules))
    return n_modules, limit, offset


@settings(
    max_examples=8,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(case=_pagination_case())
def test_c8_pagination_returns_correct_page(client, write_simlink_module, case):
    """C8: ``GET /api/v1/modulos?limit=L&offset=O`` must return the matching page.

    A unique per-example ``dominio`` isolates this example's modules from any
    other data the handler can see. The full (unpaginated) response for that
    domain is the ground-truth ordering; the paginated response must equal the
    ``[offset : offset + limit]`` slice of it.

    EXPECTED ON UNFIXED CODE: FAILS — ``limit`` / ``offset`` are undeclared query
    params, so FastAPI ignores them and the route returns the entire collection
    instead of the requested page.
    """
    n_modules, limit, offset = case
    dominio = f"pbt-c8-{uuid.uuid4().hex}.example"

    created_ids = []
    for i in range(n_modules):
        path = write_simlink_module(
            dominio=dominio,
            titulo=f"Modulo {i}",
            # Distinct criado_em so the handler's sort order is deterministic.
            criado_em=f"2024-01-01T00:{i:02d}:00",
        )
        created_ids.append(json.loads(path.read_text(encoding="utf-8"))["modulo_id"])

    # Ground-truth ordering: the handler's own unpaginated output for this domain.
    full = client.get("/api/v1/modulos", params={"dominio": dominio})
    assert full.status_code == 200, f"unpaginated listing failed: {full.status_code}"
    full_ids = [m["modulo_id"] for m in full.json()["modulos"]]
    assert set(created_ids) <= set(full_ids), (
        "test setup: written modules are not all visible to the listing route"
    )

    expected_page = full_ids[offset : offset + limit]

    paged = client.get(
        "/api/v1/modulos",
        params={"dominio": dominio, "limit": limit, "offset": offset},
    )
    assert paged.status_code == 200, f"paginated listing failed: {paged.status_code}"
    paged_ids = [m["modulo_id"] for m in paged.json()["modulos"]]

    assert paged_ids == expected_page, (
        "C8 counterexample: GET /api/v1/modulos ignored pagination "
        f"(limit={limit}, offset={offset}) over {len(full_ids)} modules. "
        f"Expected page {expected_page!r} but got {paged_ids!r}. The handler has "
        "no limit/offset support and returns the full synchronously-scanned "
        "collection on every request."
    )
