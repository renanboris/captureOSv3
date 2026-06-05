"""Bug-condition exploration test -- Repository hygiene (Property 9, Task 6).

Spec: ``.kiro/specs/production-hardening`` (bugfix). This test encodes
**Property 9 (Bug Condition -- Repository Hygiene)** from ``design.md`` and the
expected (fixed) behavior described in clauses 2.9-2.13 of ``bugfix.md``.

Bug condition::

    isBugCondition(X) is TRUE when (C9 OR C10 OR C11 OR C12 OR C13):
      C9  -- repo contains legacy_agents/
      C10 -- repo contains legacy_repos_tmp/
      C11 -- repo contains root-level real session data (session178_steps.json)
      C12 -- test_timebender.py lives at the repo root instead of tests/
      C13 -- no .env.example, OR .gitignore fails to exclude session-data
             patterns (data/, scoped session*_steps.json, session_*,
             legacy_repos_tmp/)

These assertions describe the **fixed** repository (Property 9 / clauses
2.9-2.13). They are therefore EXPECTED TO FAIL on the current unfixed code --
that failure confirms the bug exists. Per the exploratory bugfix workflow this
test is NOT to be "fixed"; it flips to passing once tasks 13.2 / 13.3 land.

    **Validates: Requirements 1.9, 1.10, 1.11, 1.12, 1.13, 2.9, 2.10, 2.11, 2.12, 2.13**

This is a deterministic facet (concrete failing cases C9-C13); it touches no
product code and implements no fix.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

# Repository root (parent of the tests/ directory). The hygiene of THIS tree is
# exactly what the bug condition is about, so we resolve paths against it.
REPO_ROOT = Path(__file__).resolve().parent.parent


def _read_gitignore_patterns() -> list[str]:
    """Return the non-empty, non-comment patterns from the repo .gitignore."""
    gitignore = REPO_ROOT / ".gitignore"
    if not gitignore.exists():
        return []
    lines = gitignore.read_text(encoding="utf-8").splitlines()
    patterns: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        patterns.append(line)
    return patterns


# --------------------------------------------------------------------------- #
# C9 -- legacy_agents/ must be absent
# --------------------------------------------------------------------------- #
def test_legacy_agents_dir_is_absent():
    """C9: dead v1/v2 browser-automation code must not be in the tree."""
    legacy_agents = REPO_ROOT / "legacy_agents"
    assert not legacy_agents.exists(), (
        "C9 counterexample: 'legacy_agents/' is present at the repo root "
        f"({legacy_agents}); dead v1/v2 code should be archived and removed "
        "from main (clauses 1.9 -> 2.9)."
    )


# --------------------------------------------------------------------------- #
# C10 -- legacy_repos_tmp/ must be absent
# --------------------------------------------------------------------------- #
def test_legacy_repos_tmp_dir_is_absent():
    """C10: the migration-artifact directory must not be in the tree."""
    legacy_repos_tmp = REPO_ROOT / "legacy_repos_tmp"
    assert not legacy_repos_tmp.exists(), (
        "C10 counterexample: 'legacy_repos_tmp/' is present at the repo root "
        f"({legacy_repos_tmp}); it should be deleted and gitignored "
        "(clauses 1.10 -> 2.10)."
    )


# --------------------------------------------------------------------------- #
# C11 -- no root-level real session data
# --------------------------------------------------------------------------- #
def test_no_root_level_session_data():
    """C11: leaked real session data must not be committed at the repo root."""
    specific = REPO_ROOT / "session178_steps.json"
    assert not specific.exists(), (
        "C11 counterexample: 'session178_steps.json' is present at the repo "
        f"root ({specific}); real session data must not be committed "
        "(clauses 1.11 -> 2.11)."
    )

    # Generalize: no session*_steps.json leaked at the root.
    leaked = sorted(p.name for p in REPO_ROOT.glob("session*_steps.json"))
    assert leaked == [], (
        "C11 counterexample: root-level session data files present: "
        f"{leaked}; none should be committed (clauses 1.11 -> 2.11)."
    )


# --------------------------------------------------------------------------- #
# C12 -- test_timebender.py must live under tests/, not the repo root
# --------------------------------------------------------------------------- #
def test_timebender_test_is_under_tests_dir():
    """C12: the orphaned test must be relocated to tests/ for discovery."""
    root_copy = REPO_ROOT / "test_timebender.py"
    tests_copy = REPO_ROOT / "tests" / "test_timebender.py"

    assert not root_copy.exists(), (
        "C12 counterexample: 'test_timebender.py' is orphaned at the repo root "
        f"({root_copy}); it should live under tests/ (clauses 1.12 -> 2.12)."
    )
    assert tests_copy.exists(), (
        "C12 counterexample: 'tests/test_timebender.py' is missing; the "
        "time-bender test should be discoverable under tests/ "
        "(clauses 1.12 -> 2.12)."
    )


# --------------------------------------------------------------------------- #
# C13 -- .env.example exists
# --------------------------------------------------------------------------- #
def test_env_example_exists():
    """C13: project setup requires a discoverable .env.example."""
    env_example = REPO_ROOT / ".env.example"
    assert env_example.exists(), (
        "C13 counterexample: '.env.example' is missing; required configuration "
        "is undiscoverable for new contributors (clauses 1.13 -> 2.13)."
    )


# --------------------------------------------------------------------------- #
# C13 -- .gitignore excludes session-data patterns
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "required_pattern, description",
    [
        ("data/", "session-data directory"),
        ("session*_steps.json", "scoped root-level leaked session files"),
        ("session_*", "session-prefixed data files"),
        ("legacy_repos_tmp/", "migration-artifact directory"),
    ],
)
def test_gitignore_excludes_session_data_patterns(required_pattern: str, description: str):
    """C13: .gitignore must exclude session-data patterns so leaks can't recur."""
    patterns = _read_gitignore_patterns()
    assert required_pattern in patterns, (
        f"C13 counterexample: .gitignore does not exclude {required_pattern!r} "
        f"({description}); present patterns are {patterns}. Sensitive data is at "
        "risk of being committed (clauses 1.13 -> 2.13)."
    )
