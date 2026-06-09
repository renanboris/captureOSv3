"""Preservation property tests — Property 2: Existing Corrections and Substring Safety.

Spec: ``.kiro/specs/tts-pronunciation-fix`` (bugfix), Task 2 / Property 2.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

This test suite verifies that the fix for SIGN pronunciation does NOT regress
existing behavior. It follows the observation-first methodology:

1. Observe behavior on UNFIXED code for non-buggy inputs (texts without standalone "sign")
2. Write property-based tests confirming that behavior is preserved after the fix

Observations on UNFIXED code:
- "This is a design pattern" → "design" unchanged
- "Send a signal now" → "signal" unchanged
- "Assign the task" → "assign" unchanged
- "The GED senior template" → "gédi", "Sênior", "têmpleit" applied
- "foo_bar | baz" → underscore and pipe substitutions applied
- "O sistema está funcionando" → no changes

EXPECTED OUTCOME: All tests PASS on unfixed code (confirms baseline to preserve).
"""

from __future__ import annotations

import re

import pytest
from hypothesis import HealthCheck, given, settings, assume
from hypothesis import strategies as st


# --------------------------------------------------------------------------- #
# Extracted phonetic correction logic (mirrors gerar_audio in tts_generator.py)
# --------------------------------------------------------------------------- #

def apply_phonetic_corrections_original(texto: str) -> str:
    """Apply the ORIGINAL phonetic corrections from gerar_audio (UNFIXED code).

    This is an exact extraction of the correction logic from
    video_eng/tts_generator.py without the SIGN fix.
    """
    if not texto or not texto.strip():
        return texto

    # Correções fonéticas corporativas (legado)
    texto_falado = re.sub(r"(?i)\becm_ged\b", "E C M gédi", texto)
    texto_falado = re.sub(r"\bGED\b", "gédi", texto_falado)
    texto_falado = re.sub(r"\bged\b", "gédi", texto_falado)
    texto_falado = re.sub(r"(?i)\bsenior\b", "Sênior", texto_falado)
    texto_falado = re.sub(r"\bX\b", "Éks", texto_falado)
    texto_falado = re.sub(
        r"(?i)\btemplates?\b",
        lambda m: "têmpleits" if m.group().lower().endswith("s") else "têmpleit",
        texto_falado,
    )

    # Anti-engasgos do TTS
    texto_falado = texto_falado.replace("_", " ")
    texto_falado = re.sub(r"\s*[|/]\s*", ", ", texto_falado)
    texto_falado = re.sub(r" {2,}", " ", texto_falado).strip()

    return texto_falado


def apply_phonetic_corrections_fixed(texto: str) -> str:
    """Apply the FIXED phonetic corrections (with SIGN rule added).

    Identical to original but adds the sign → sáin substitution after
    the templates rule, as specified in the design document.
    """
    if not texto or not texto.strip():
        return texto

    # Correções fonéticas corporativas (legado)
    texto_falado = re.sub(r"(?i)\becm_ged\b", "E C M gédi", texto)
    texto_falado = re.sub(r"\bGED\b", "gédi", texto_falado)
    texto_falado = re.sub(r"\bged\b", "gédi", texto_falado)
    texto_falado = re.sub(r"(?i)\bsenior\b", "Sênior", texto_falado)
    texto_falado = re.sub(r"\bX\b", "Éks", texto_falado)
    texto_falado = re.sub(
        r"(?i)\btemplates?\b",
        lambda m: "têmpleits" if m.group().lower().endswith("s") else "têmpleit",
        texto_falado,
    )
    # NEW: SIGN phonetic correction (the fix)
    texto_falado = re.sub(r"(?i)\bsign\b", "sáin", texto_falado)

    # Anti-engasgos do TTS
    texto_falado = texto_falado.replace("_", " ")
    texto_falado = re.sub(r"\s*[|/]\s*", ", ", texto_falado)
    texto_falado = re.sub(r" {2,}", " ", texto_falado).strip()

    return texto_falado


# --------------------------------------------------------------------------- #
# Observation tests — confirm behavior on UNFIXED code
# --------------------------------------------------------------------------- #

class TestObservations:
    """Observation-first: confirm expected behavior of unfixed code on non-buggy inputs."""

    def test_design_unchanged(self):
        """'design' contains 'sign' as substring but must remain unchanged."""
        result = apply_phonetic_corrections_original("This is a design pattern")
        assert "design" in result

    def test_signal_unchanged(self):
        """'signal' contains 'sign' as substring but must remain unchanged."""
        result = apply_phonetic_corrections_original("Send a signal now")
        assert "signal" in result

    def test_assign_unchanged(self):
        """'assign' contains 'sign' as substring but must remain unchanged."""
        result = apply_phonetic_corrections_original("Assign the task")
        # Note: underscore rule doesn't affect this; word boundary doesn't match substring
        assert "ssign" in result.lower() or "assign" in result.lower()

    def test_existing_corrections_applied(self):
        """GED, senior, template corrections are applied on unfixed code."""
        result = apply_phonetic_corrections_original("The GED senior template")
        assert "gédi" in result
        assert "Sênior" in result
        assert "têmpleit" in result

    def test_anti_stutter_rules_applied(self):
        """Underscore → space, pipe → comma substitutions are applied."""
        result = apply_phonetic_corrections_original("foo_bar | baz")
        assert "_" not in result
        assert "|" not in result
        assert "foo bar" in result
        assert ", " in result

    def test_portuguese_text_unchanged(self):
        """Pure Portuguese text passes through without modification."""
        original = "O sistema está funcionando"
        result = apply_phonetic_corrections_original(original)
        assert result == original


# --------------------------------------------------------------------------- #
# Property 2a: For texts without standalone "sign", original == fixed
# --------------------------------------------------------------------------- #

# Strategy: generate text that does NOT contain standalone "sign"
# We use text() and filter out any that match the bug condition regex
_NO_STANDALONE_SIGN = st.text(
    alphabet=st.characters(
        whitelist_categories=("L", "N", "P", "Z", "S"),
        blacklist_characters="\x00",
    ),
    min_size=1,
    max_size=200,
).filter(lambda t: not re.search(r"(?i)\bsign\b", t))


@settings(
    max_examples=200,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.filter_too_much],
)
@given(text=_NO_STANDALONE_SIGN)
def test_preservation_no_standalone_sign(text):
    """Property 2a: For all texts where (?i)\\bsign\\b does NOT match,
    the original and fixed functions produce identical output.

    **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
    """
    original_result = apply_phonetic_corrections_original(text)
    fixed_result = apply_phonetic_corrections_fixed(text)
    assert original_result == fixed_result, (
        f"Preservation violated!\n"
        f"  Input: {text!r}\n"
        f"  Original: {original_result!r}\n"
        f"  Fixed:    {fixed_result!r}"
    )


# --------------------------------------------------------------------------- #
# Property 2b: Words containing "sign" as substring remain unchanged
# --------------------------------------------------------------------------- #

SIGN_SUBSTRING_WORDS = ["design", "signal", "assign", "resignation", "signage"]

_SIGN_SUBSTRING_STRATEGY = st.sampled_from(SIGN_SUBSTRING_WORDS)

# Build sentences around the substring word
_SENTENCE_WITH_SIGN_SUBSTRING = st.tuples(
    st.text(
        alphabet=st.characters(whitelist_categories=("L", "N", "Z"), blacklist_characters="\x00"),
        min_size=0,
        max_size=30,
    ),
    _SIGN_SUBSTRING_STRATEGY,
    st.text(
        alphabet=st.characters(whitelist_categories=("L", "N", "Z"), blacklist_characters="\x00"),
        min_size=0,
        max_size=30,
    ),
).map(lambda t: f"{t[0]} {t[1]} {t[2]}".strip())


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
@given(text=_SENTENCE_WITH_SIGN_SUBSTRING)
def test_substring_words_unchanged(text):
    """Property 2b: Words containing 'sign' as a substring ('design', 'signal',
    'assign', 'resignation', 'signage') remain unchanged after correction.

    **Validates: Requirements 3.5**
    """
    result = apply_phonetic_corrections_fixed(text)
    # The substring words should still be present (not replaced with "sáin")
    for word in SIGN_SUBSTRING_WORDS:
        if word in text.lower():
            # The word (case-insensitive) should still be present in the result
            assert word in result.lower(), (
                f"Substring word '{word}' was incorrectly modified!\n"
                f"  Input:  {text!r}\n"
                f"  Result: {result!r}"
            )


# --------------------------------------------------------------------------- #
# Property 2c: Existing correction words still get corrected properly
# --------------------------------------------------------------------------- #

EXISTING_CORRECTIONS = {
    "GED": "gédi",
    "senior": "Sênior",
    "template": "têmpleit",
    "templates": "têmpleits",
}

_CORRECTION_WORD_STRATEGY = st.sampled_from(list(EXISTING_CORRECTIONS.keys()))

# Build sentences with existing correction words
_SENTENCE_WITH_CORRECTION = st.tuples(
    st.text(
        alphabet=st.characters(whitelist_categories=("L", "Z"), blacklist_characters="\x00"),
        min_size=0,
        max_size=20,
    ),
    _CORRECTION_WORD_STRATEGY,
    st.text(
        alphabet=st.characters(whitelist_categories=("L", "Z"), blacklist_characters="\x00"),
        min_size=0,
        max_size=20,
    ),
).map(lambda t: f"{t[0]} {t[1]} {t[2]}".strip())


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
@given(text=_SENTENCE_WITH_CORRECTION)
def test_existing_corrections_still_applied(text):
    """Property 2c: Existing correction words ('GED', 'senior', 'template',
    'templates') still get their phonetic corrections applied after the fix.

    **Validates: Requirements 3.1**
    """
    result = apply_phonetic_corrections_fixed(text)
    # Check that each correction word present in the input gets corrected
    for word, correction in EXISTING_CORRECTIONS.items():
        if re.search(r"(?i)\b" + re.escape(word) + r"\b", text):
            assert correction in result, (
                f"Existing correction for '{word}' → '{correction}' not applied!\n"
                f"  Input:  {text!r}\n"
                f"  Result: {result!r}"
            )
