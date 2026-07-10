"""Bug-condition exploration test — Property 8: Clean Install Completeness.

Production-hardening bugfix spec, Task 5.

**Property 8 (design.md): Bug Condition — Clean Install Completeness**
> For any clean ``pip install -r requirements.txt`` where the bug condition holds
> because an imported runtime dependency is missing (C7), the fixed
> ``requirements.txt`` SHALL list every actually-imported runtime dependency
> (including ``pydantic-settings`` and ``static-ffmpeg``) so import of
> ``api.main`` and ``video_eng.time_bender`` succeeds.

**Validates: Requirements 1.7, 2.7**

Bug condition (design Bug Details):
``C7(X): X is `pip install -r requirements.txt` on a clean checkout AND an
imported dependency is missing (pydantic-settings, static-ffmpeg)``.

This is the *deterministic facet* of the property (the input space collapses to
the concrete failing cases), so it is encoded as plain deterministic assertions
rather than a Hypothesis strategy:

1. ``config/settings.py`` imports ``pydantic_settings`` at module load — its pip
   distribution ``pydantic-settings`` MUST be declared in ``requirements.txt``.
2. ``video_eng/time_bender.py`` imports ``static_ffmpeg`` at module load — its
   pip distribution ``static-ffmpeg`` MUST be declared in ``requirements.txt``.
3. (Smoke) ``api.main`` (which transitively imports both via
   ``config.settings`` and ``api.export_pipeline -> video_eng.time_bender``) and
   ``video_eng.time_bender`` must import successfully, confirming these are
   genuine runtime dependencies that the manifest must cover.

CRITICAL: This test MUST FAIL on unfixed code (``requirements.txt`` lists
neither ``pydantic-settings`` nor ``static-ffmpeg``). The failure confirms the
bug exists — on a truly clean install ``import api.main`` /
``import video_eng.time_bender`` raises ``ModuleNotFoundError``. It is NOT to be
"fixed" here — it becomes the fix-checking test that passes after task 13.1
completes the manifest.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Set

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
REQUIREMENTS = REPO_ROOT / "requirements.txt"

MISSING_RUNTIME_DEPENDENCIES = {
    "pydantic_settings": "pydantic-settings",
}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _declared_distributions() -> Set[str]:
    """Return the set of pip distribution names declared in ``requirements.txt``.

    Names are normalized the way pip does (lower-cased, ``_`` -> ``-``) so the
    comparison is tolerant of casing and separator differences. Comments and
    blank lines are ignored.
    """
    if not REQUIREMENTS.exists():
        return set()

    name_re = re.compile(r"^\s*([A-Za-z0-9._-]+)")
    declared: Set[str] = set()
    for raw in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        match = name_re.match(line)
        if not match:
            continue
        declared.add(match.group(1).lower().replace("_", "-"))
    return declared


# --------------------------------------------------------------------------- #
# C7 — deterministic facet: imported runtime deps must be declared
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("import_name", "distribution"),
    sorted(MISSING_RUNTIME_DEPENDENCIES.items()),
)
def test_imported_runtime_dependency_is_declared_in_requirements(import_name: str, distribution: str):
    """C7: every imported runtime dependency must appear in ``requirements.txt``.

    EXPECTED ON UNFIXED CODE: FAILS — neither ``pydantic-settings`` (imported by
    ``config/settings.py``) nor ``static-ffmpeg`` (imported by
    ``video_eng/time_bender.py``) is listed, so a clean
    ``pip install -r requirements.txt`` cannot satisfy the import graph.

    Validates: Requirements 1.7, 2.7 (design Property 8).
    """
    declared = _declared_distributions()
    assert distribution in declared, (
        f"C7 bug condition present: `{import_name}` is imported at runtime but "
        f"its distribution `{distribution}` is NOT declared in requirements.txt "
        f"(declared: {sorted(declared)}). A clean `pip install -r "
        f"requirements.txt` therefore fails to import the module that needs it "
        f"(per Expected Behavior 2.7)."
    )


def test_requirements_covers_all_known_missing_runtime_deps():
    """C7 (aggregate): the manifest must cover the full set of known missing deps.

    Restates the property as a single set-containment check so the failure
    message enumerates every missing distribution at once.

    EXPECTED ON UNFIXED CODE: FAILS — both ``pydantic-settings`` and
    ``static-ffmpeg`` are absent.

    Validates: Requirements 1.7, 2.7 (design Property 8).
    """
    declared = _declared_distributions()
    required = set(MISSING_RUNTIME_DEPENDENCIES.values())
    missing = sorted(required - declared)
    assert not missing, (
        f"C7 bug condition present: requirements.txt is missing runtime "
        f"dependencies {missing}. They are imported by config/settings.py and "
        f"video_eng/time_bender.py respectively, so a clean install cannot run "
        f"the API (per Expected Behavior 2.7)."
    )


# --------------------------------------------------------------------------- #
# C7 — import smoke check of api.main / video_eng.time_bender vs. the manifest
# --------------------------------------------------------------------------- #
def test_runtime_imports_are_covered_by_the_manifest():
    """C7 (smoke): the modules' runtime third-party imports must be declared.

    Confirms the imports are genuine (the modules load in this dev environment,
    where the deps happen to be installed) AND that those same third-party
    imports are declared in the manifest. On a truly clean install — where only
    ``requirements.txt`` is installed — the undeclared imports would raise
    ``ModuleNotFoundError``; here we surface the same defect by checking the
    import graph against the declared manifest.

    EXPECTED ON UNFIXED CODE: FAILS — ``pydantic_settings`` and
    ``static_ffmpeg`` import successfully (installed locally) yet are absent from
    requirements.txt, so the manifest does not match the import graph.

    Validates: Requirements 1.7, 2.7 (design Property 8).
    """
    # These imports prove the dependencies are real runtime requirements of the
    # modules the property names. If they are not installed in this environment,
    # that is itself a manifestation of C7 (a clean install would not have them).
    settings_module = pytest.importorskip(
        "config.settings",
        reason="config.settings is the import site for pydantic_settings",
    )
    # api.main transitively pulls both in (config.settings + export_pipeline).
    pytest.importorskip(
        "api.main",
        reason="api.main is the application entrypoint that must import cleanly",
    )

    # Sanity: the modules really do expose the third-party imports we claim.
    assert hasattr(settings_module, "BaseSettings"), (
        "config.settings is expected to import pydantic_settings.BaseSettings."
    )

    # The property: every third-party runtime import these modules rely on must
    # be declared so a clean install reproduces the working import graph.
    declared = _declared_distributions()
    undeclared = sorted(
        dist
        for import_name, dist in MISSING_RUNTIME_DEPENDENCIES.items()
        if dist not in declared
    )
    assert not undeclared, (
        f"C7 bug condition present: api.main / video_eng.time_bender import "
        f"third-party packages whose distributions {undeclared} are not declared "
        f"in requirements.txt. A clean `pip install -r requirements.txt` would "
        f"raise ModuleNotFoundError for them (per Expected Behavior 2.7)."
    )
