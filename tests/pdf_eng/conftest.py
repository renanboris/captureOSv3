"""Hypothesis strategies shared across the pdf_eng test suite.

Feature: manual-builder-improvements
Requirements: 4.1

This module provides reusable strategies for generating test inputs for the
Manual Builder property-based tests.  All strategies are exposed as plain
functions (not fixtures) so they can be used directly inside ``@given``
decorators in any test file under ``tests/pdf_eng/``.
"""

from __future__ import annotations

import sys
from pathlib import Path

from hypothesis import settings, HealthCheck

settings.register_profile("fast", max_examples=20, suppress_health_check=[HealthCheck.too_slow])
settings.load_profile("fast")

# Ensure the repository root is on sys.path so ``pdf_eng`` package is importable
# when pytest runs tests/pdf_eng/ as a package (due to the __init__.py).
_REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from typing import Optional

from hypothesis import strategies as st


# ---------------------------------------------------------------------------
# Primitive text strategies
# ---------------------------------------------------------------------------

def non_empty_text() -> st.SearchStrategy[str]:
    """Strategy that generates strings containing at least one non-whitespace character.

    Used wherever a valid, non-blank title or anchor text is required.
    """
    # Generate a printable text of 1-50 chars that is NOT purely whitespace.
    return (
        st.text(
            alphabet=st.characters(
                whitelist_categories=("L", "N", "P", "S"),  # letters, numbers, punctuation, symbols
                whitelist_characters=" \t",                   # allow some whitespace too
            ),
            min_size=1,
            max_size=50,
        )
        .filter(lambda s: s.strip() != "")
    )


def whitespace_text() -> st.SearchStrategy[str]:
    """Strategy that generates strings composed entirely of whitespace characters.

    Used to test the behaviour of passos/titles that are blank or whitespace-only.
    """
    return st.text(
        alphabet=st.sampled_from([" ", "\t", "\n", "\r"]),
        min_size=0,
        max_size=10,
    )


# ---------------------------------------------------------------------------
# Roteiro / step strategies
# ---------------------------------------------------------------------------

def _simlink_strategy() -> st.SearchStrategy[dict]:
    """Build a ``_simlink`` sub-dict that mirrors the actual pipeline structure."""
    return st.fixed_dictionaries(
        {
            "screenshot_path": st.just(""),   # No real file needed for pure-logic tests
            "action": st.sampled_from(["click", "navigation", "input", "scroll", "other"]),
        }
    )


def _regular_step_strategy(step_number: Optional[int] = None) -> st.SearchStrategy[dict]:
    """Build a single regular passo dict (passo ≠ 0 and ≠ 999).

    If *step_number* is ``None`` the step number is drawn from ``integers(1, 998)``.
    """
    num_strategy = st.just(step_number) if step_number is not None else st.integers(min_value=1, max_value=998)
    return st.fixed_dictionaries(
        {
            "passo": num_strategy,
            "ancora": st.one_of(st.just(""), non_empty_text()),
            "micro_narracao": st.one_of(st.just(""), non_empty_text()),
            "_simlink": _simlink_strategy(),
        }
    )


def list_of_regular_steps() -> st.SearchStrategy[list]:
    """Strategy that generates a list of 0–5 regular passos (passo ∈ [1, 998]).

    Step numbers within each list are made unique so the roteiro is internally
    consistent (no duplicate step numbers).

    Used by property tests that inject a custom passo 0 or 999 alongside
    regular content.
    """
    @st.composite
    def _unique_regular_steps(draw):
        count = draw(st.integers(min_value=0, max_value=5))
        if count == 0:
            return []
        # Draw `count` unique step numbers from 1..998
        step_numbers = draw(
            st.lists(
                st.integers(min_value=1, max_value=998),
                min_size=count,
                max_size=count,
                unique=True,
            )
        )
        steps = []
        for num in sorted(step_numbers):
            step = draw(_regular_step_strategy(step_number=num))
            steps.append(step)
        return steps

    return _unique_regular_steps()


def _intro_step_strategy() -> st.SearchStrategy[dict]:
    """Build an optional passo 0 (intro) dict."""
    return st.fixed_dictionaries(
        {
            "passo": st.just(0),
            "ancora": st.one_of(st.just(""), st.just(None), non_empty_text()),
            "micro_narracao": st.one_of(st.just(""), non_empty_text()),
            "_simlink": _simlink_strategy(),
        }
    )


def _conclusion_step_strategy() -> st.SearchStrategy[dict]:
    """Build an optional passo 999 (conclusion) dict."""
    return st.fixed_dictionaries(
        {
            "passo": st.just(999),
            "ancora": st.one_of(st.just(""), st.just(None), non_empty_text()),
            "micro_narracao": st.one_of(st.just(""), non_empty_text()),
            "_simlink": _simlink_strategy(),
        }
    )


@st.composite
def valid_roteiro_strategy(draw) -> list:
    """Strategy that generates a complete, valid roteiro list.

    A roteiro is a list of passo dicts with the following shape::

        {
            "passo": int,
            "ancora": str | None,
            "micro_narracao": str,
            "_simlink": {"screenshot_path": str, "action": str},
        }

    The generated roteiro:
    - Optionally includes a passo 0 (intro).
    - Optionally includes a passo 999 (conclusion).
    - Includes 0–10 regular passos with unique step numbers drawn from [1, 998].
    - May be empty (empty list is a degenerate but valid roteiro).

    Requirements: 4.1
    """
    regular_steps = draw(list_of_regular_steps())

    # Optionally prepend intro and append conclusion
    include_intro = draw(st.booleans())
    include_conclusion = draw(st.booleans())

    roteiro: list = []

    if include_intro:
        roteiro.append(draw(_intro_step_strategy()))

    roteiro.extend(regular_steps)

    if include_conclusion:
        roteiro.append(draw(_conclusion_step_strategy()))

    return roteiro
