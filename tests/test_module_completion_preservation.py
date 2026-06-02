"""Preservation property tests — Module Data and Completion Equivalence (Task 11).

Property 6: Preservation — Module Data and Completion Equivalence
    _For any_ simlink request where the bug condition does NOT hold, the fixed
    handlers SHALL return module data, record completions, and fire LMS
    callbacks identical to the original implementation (the full unpaginated
    result equals the concatenation of pages in order).

**Validates: Requirements 3.5**

Observation-first methodology
-----------------------------
The baseline behavior was observed on the UNFIXED code before writing these
assertions:

* ``GET /api/v1/modulos`` returns ``{"modulos": [...], "total": N}`` with the
  modules sorted by ``criado_em`` descending. Each entry is the projected
  shape ``{modulo_id, titulo, total_passos, xp_max, dominio, criado_em,
  session_id}``. On unfixed code ``limit``/``offset`` are IGNORED — every call
  returns the full list (this is the C8 defect surfaced separately by the
  Property 5 exploration test, NOT asserted here).
* ``GET /api/v1/simlink/{id}`` returns the full stored module dict; an unknown
  id returns ``404``.
* ``POST /api/v1/simlink/{id}/conclusao`` writes ``{id}_resultado.json``,
  fires the LMS callback only when the module has an ``lms_callback_url``, and
  returns ``{"status": "ok"}``.

These tests MUST PASS on the unfixed code (baseline capture) and continue to
pass after the fix (tasks 14.6 adds pagination + non-blocking I/O). The
pagination-concatenation property is expressed via :func:`_paginate_all`, a
helper that reproduces the full ordered list on BOTH the unfixed code (one page
returns everything) and the fixed code (pages partition the list), so the
invariant "concatenation of pages in order == full unpaginated result" holds in
both regimes.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

# Fields the listing route projects for each module (observed on unfixed code).
_LISTING_FIELDS = (
    "modulo_id",
    "titulo",
    "total_passos",
    "xp_max",
    "dominio",
    "criado_em",
    "session_id",
)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _fetch_full(client) -> Dict[str, Any]:
    """The full, unpaginated listing — the baseline reference result."""
    resp = client.get("/api/v1/modulos")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "modulos" in body and "total" in body
    return body


def _paginate_all(client, page_size: int) -> List[Dict[str, Any]]:
    """Collect modules page by page, preserving order and de-duplicating.

    Robust across both regimes:

    * Unfixed code ignores ``limit``/``offset``: the first page returns the full
      list, we collect it, observe ``len(collected) >= total`` and stop.
    * Fixed code paginates: each page contributes the next slice; we stop once
      we have ``total`` items or a page yields nothing new.

    The returned list is the in-order concatenation of pages, which must equal
    the full unpaginated ``modulos`` list.
    """
    first = client.get("/api/v1/modulos", params={"limit": page_size, "offset": 0})
    assert first.status_code == 200, first.text
    total = int(first.json().get("total", 0))

    collected: List[Dict[str, Any]] = []
    seen: set = set()
    offset = 0
    # Safety cap so a misbehaving handler can never spin forever.
    max_pages = (total // max(page_size, 1)) + 5

    for _ in range(max_pages):
        resp = client.get("/api/v1/modulos", params={"limit": page_size, "offset": offset})
        assert resp.status_code == 200, resp.text
        items = resp.json().get("modulos", [])
        new_items = [m for m in items if m.get("modulo_id") not in seen]
        if not new_items:
            break
        for m in new_items:
            seen.add(m.get("modulo_id"))
            collected.append(m)
        if len(collected) >= total:
            break
        offset += page_size

    return collected


# --------------------------------------------------------------------------- #
# Property-based test: pagination concatenation == full unpaginated result
# --------------------------------------------------------------------------- #
@st.composite
def _module_collection(draw) -> Tuple[List[Dict[str, Any]], int]:
    """Generate a random collection of distinct modules and a page size."""
    n = draw(st.integers(min_value=0, max_value=6))
    batch = uuid.uuid4().hex[:8]
    # A small pool of timestamps so ties (equal criado_em) are exercised too.
    timestamps = [
        "2024-01-01T00:00:00",
        "2024-02-15T12:30:00",
        "2024-03-20T08:00:00",
        "2024-05-05T23:59:59",
    ]
    # Constrain the title alphabet to printable, non-surrogate characters so the
    # generator never produces a string that fails UTF-8 file encoding — the
    # property under test is data preservation, not unicode encoding edge cases.
    safe_text = st.text(
        alphabet=st.characters(min_codepoint=32, max_codepoint=0x7E),
        min_size=0,
        max_size=20,
    )
    modules: List[Dict[str, Any]] = []
    for i in range(n):
        modules.append(
            {
                "modulo_id": f"sess_pbt_{batch}_{i}",
                "titulo": draw(safe_text),
                "dominio": draw(st.sampled_from(["a.example", "b.example", ""])),
                "total_passos": draw(st.integers(min_value=0, max_value=4)),
                "xp_max": draw(st.integers(min_value=0, max_value=100)),
                "criado_em": draw(st.sampled_from(timestamps)),
            }
        )
    page_size = draw(st.integers(min_value=1, max_value=n + 2))
    return modules, page_size


@settings(
    max_examples=10,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(data=_module_collection())
def test_paginated_pages_concatenate_to_full_result(
    data, client, simlink_dir: Path, simlink_module_factory
):
    """Concatenation of paginated pages (in order) equals the full result, and
    every generated module appears with its data preserved.

    **Validates: Requirements 3.5**
    """
    modules, page_size = data
    written: List[Path] = []
    try:
        for spec in modules:
            modulo = simlink_module_factory(
                modulo_id=spec["modulo_id"],
                titulo=spec["titulo"],
                dominio=spec["dominio"],
                total_passos=spec["total_passos"],
                xp_max=spec["xp_max"],
                criado_em=spec["criado_em"],
            )
            path = simlink_dir / f"{modulo['modulo_id']}.json"
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(modulo, fh, ensure_ascii=False)
            written.append(path)

        full = _fetch_full(client)
        full_modules = full["modulos"]

        # 1) Pagination preserves the full ordered listing.
        paginated = _paginate_all(client, page_size)
        assert paginated == full_modules, (
            "Concatenation of paginated pages must equal the full unpaginated "
            f"result. page_size={page_size}\nfull={full_modules}\n"
            f"paginated={paginated}"
        )

        # 2) total matches the listing length.
        assert full["total"] == len(full_modules)

        # 3) Every generated module is present with its data preserved.
        by_id = {m["modulo_id"]: m for m in full_modules}
        for spec in modules:
            mid = spec["modulo_id"]
            assert mid in by_id, f"Module {mid} missing from listing"
            entry = by_id[mid]
            for field in _LISTING_FIELDS:
                assert field in entry, f"Listing entry missing field {field!r}"
            assert entry["titulo"] == spec["titulo"]
            assert entry["dominio"] == spec["dominio"]
            assert entry["total_passos"] == spec["total_passos"]
            assert entry["xp_max"] == spec["xp_max"]
            assert entry["criado_em"] == spec["criado_em"]
            assert entry["session_id"] == mid

        # 4) Listing is sorted by criado_em descending (stable).
        criado = [m.get("criado_em", "") for m in full_modules]
        assert criado == sorted(criado, reverse=True)
    finally:
        for path in written:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


# --------------------------------------------------------------------------- #
# Single-module fetch equivalence
# --------------------------------------------------------------------------- #
def test_single_module_fetch_returns_full_module(client, write_simlink_module):
    """GET /api/v1/simlink/{id} returns the full stored module unchanged.

    **Validates: Requirements 3.5**
    """
    path = write_simlink_module(
        titulo="Fetch Me",
        dominio="fetch.example",
        total_passos=2,
        xp_max=25,
        criado_em="2024-04-04T10:00:00",
    )
    stored = json.loads(path.read_text(encoding="utf-8"))
    modulo_id = stored["modulo_id"]

    resp = client.get(f"/api/v1/simlink/{modulo_id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # The full module dict is returned verbatim (all stored fields preserved).
    assert body == stored


def test_single_module_fetch_unknown_id_returns_404(client):
    """An unknown module id yields 404 — baseline error behavior preserved.

    **Validates: Requirements 3.5**
    """
    resp = client.get(f"/api/v1/simlink/does_not_exist_{uuid.uuid4().hex}")
    assert resp.status_code == 404


# --------------------------------------------------------------------------- #
# Conclusao + LMS callback equivalence
# --------------------------------------------------------------------------- #
def _cleanup_resultado(simlink_dir: Path, modulo_id: str) -> None:
    try:
        (simlink_dir / f"{modulo_id}_resultado.json").unlink(missing_ok=True)
    except OSError:
        pass


def test_conclusao_without_lms_callback(client, write_simlink_module, simlink_dir, monkeypatch):
    """Recording a completion persists the result and returns status ok; no LMS
    callback fires when the module has no callback URL.

    **Validates: Requirements 3.5**
    """
    calls: List[Dict[str, Any]] = []

    async def _fake_coro():
        return True

    def _fake_lms(*args, **kwargs):
        calls.append({"args": args, "kwargs": kwargs})
        return _fake_coro()

    monkeypatch.setattr("simlink_eng.lms_callback.reportar_conclusao_lms", _fake_lms)

    path = write_simlink_module(titulo="No Callback", xp_max=30)
    modulo_id = json.loads(path.read_text(encoding="utf-8"))["modulo_id"]

    try:
        payload = {"xp": 20, "completado": True}
        resp = client.post(f"/api/v1/simlink/{modulo_id}/conclusao", json=payload)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "ok"}

        # Result was persisted with the exact payload.
        resultado_path = simlink_dir / f"{modulo_id}_resultado.json"
        assert resultado_path.exists()
        assert json.loads(resultado_path.read_text(encoding="utf-8")) == payload

        # No LMS callback because the module has no lms_callback_url.
        assert calls == []
    finally:
        _cleanup_resultado(simlink_dir, modulo_id)


def test_conclusao_with_lms_callback_fires(client, write_simlink_module, simlink_dir, monkeypatch):
    """When the module has an LMS callback URL, the conclusao route fires the
    callback exactly once with the observed argument shape.

    **Validates: Requirements 3.5**
    """
    calls: List[Dict[str, Any]] = []

    async def _fake_coro():
        return True

    def _fake_lms(*args, **kwargs):
        calls.append({"args": args, "kwargs": kwargs})
        return _fake_coro()

    monkeypatch.setattr("simlink_eng.lms_callback.reportar_conclusao_lms", _fake_lms)

    path = write_simlink_module(
        titulo="With Callback",
        xp_max=40,
        lms_callback_url="https://lms.example/callback",
        lms_callback_token="tok-123",
    )
    modulo_id = json.loads(path.read_text(encoding="utf-8"))["modulo_id"]

    try:
        payload = {"xp": 36, "completado": True}
        resp = client.post(f"/api/v1/simlink/{modulo_id}/conclusao", json=payload)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "ok"}

        # Exactly one callback fired with the baseline positional argument shape:
        # (callback_url, token, modulo_id, xp, xp_max, completado).
        assert len(calls) == 1, f"expected one LMS callback, got {calls}"
        args = calls[0]["args"]
        assert args[0] == "https://lms.example/callback"
        assert args[1] == "tok-123"
        assert args[2] == modulo_id
        assert args[3] == 36           # payload xp
        assert args[4] == 40           # module xp_max
        assert args[5] is True         # completado
    finally:
        _cleanup_resultado(simlink_dir, modulo_id)
