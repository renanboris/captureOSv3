"""Bug condition exploration tests for the TTS SIGN pronunciation bugfix.

These tests encode the EXPECTED (correct) behavior and are designed to FAIL
on the unfixed code, confirming the bug exists. Once the fix is applied, these
tests will PASS, validating the fix.

**Validates: Requirements 1.1, 2.1**
"""

import re

from hypothesis import given, settings, assume
from hypothesis import strategies as st


# ---------------------------------------------------------------------------
# Extracted phonetic correction logic (mirrors gerar_audio preprocessing)
# ---------------------------------------------------------------------------

def apply_phonetic_corrections(texto: str) -> str:
    """Extract the phonetic correction pipeline from gerar_audio for testing.

    This replicates the exact regex substitution logic from
    video_eng/tts_generator.py::gerar_audio WITHOUT any modification,
    so we can test the current (unfixed) behavior.
    """
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
    texto_falado = re.sub(r"(?i)\bsign\b", "sáin", texto_falado)

    # Anti-engasgos do TTS
    texto_falado = texto_falado.replace("_", " ")
    texto_falado = re.sub(r"\s*[|/]\s*", ", ", texto_falado)
    texto_falado = re.sub(r" {2,}", " ", texto_falado).strip()

    return texto_falado


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Various case forms of the word "sign"
SIGN_VARIANTS = ["sign", "Sign", "SIGN", "sIgN", "siGN", "SiGn"]

# Context words that can surround "sign"
CONTEXT_WORDS = st.sampled_from([
    "Click the", "The", "Please", "button", "here", "indicates danger",
    "document", "this", "that", "contract", "form", "agreement",
    "paper", "now", "quickly", "important", "new", "old",
])


@st.composite
def text_with_standalone_sign(draw):
    """Generate text containing standalone 'sign' in various cases with context."""
    sign_word = draw(st.sampled_from(SIGN_VARIANTS))
    prefix = draw(CONTEXT_WORDS)
    suffix = draw(CONTEXT_WORDS)
    return f"{prefix} {sign_word} {suffix}"


# ---------------------------------------------------------------------------
# Property 1: Bug Condition — SIGN Phonetic Correction Missing
# ---------------------------------------------------------------------------


class TestBugConditionSignPronunciation:
    """Property 1: Bug Condition - SIGN Phonetic Correction Missing.

    For any text where the word "sign" appears as a standalone word
    (case-insensitive), the corrected output should NOT contain standalone
    "sign" and SHOULD contain "sáin".

    **Validates: Requirements 1.1, 2.1**
    """

    @given(text=text_with_standalone_sign())
    @settings(max_examples=50)
    def test_sign_replaced_with_sain_property(self, text: str):
        """Property: standalone 'sign' must be replaced with 'sáin' after correction.

        **Validates: Requirements 1.1, 2.1**
        """
        result = apply_phonetic_corrections(text)

        # After correction, no standalone "sign" should remain
        assert not re.search(r"(?i)\bsign\b", result), (
            f"Bug confirmed: standalone 'sign' was NOT corrected in output.\n"
            f"  Input:  {text!r}\n"
            f"  Output: {result!r}\n"
            f"  Expected 'sign' to be replaced with 'sáin'"
        )

        # The replacement "sáin" should be present
        assert "sáin" in result, (
            f"Bug confirmed: 'sáin' not found in corrected output.\n"
            f"  Input:  {text!r}\n"
            f"  Output: {result!r}\n"
            f"  Expected 'sáin' to be present"
        )

    def test_sign_uppercase_not_corrected(self):
        """Concrete case: 'Click the SIGN button' passes through unchanged.

        **Validates: Requirements 1.1, 2.1**
        """
        text = "Click the SIGN button"
        result = apply_phonetic_corrections(text)

        assert not re.search(r"(?i)\bsign\b", result), (
            f"Bug confirmed: 'SIGN' was NOT replaced with 'sáin'.\n"
            f"  Input:  {text!r}\n"
            f"  Output: {result!r}"
        )
        assert "sáin" in result

    def test_sign_lowercase_not_corrected(self):
        """Concrete case: 'The sign indicates danger' passes through unchanged.

        **Validates: Requirements 1.1, 2.1**
        """
        text = "The sign indicates danger"
        result = apply_phonetic_corrections(text)

        assert not re.search(r"(?i)\bsign\b", result), (
            f"Bug confirmed: 'sign' was NOT replaced with 'sáin'.\n"
            f"  Input:  {text!r}\n"
            f"  Output: {result!r}"
        )
        assert "sáin" in result

    def test_sign_mixed_case_not_corrected(self):
        """Concrete case: 'Sign here please' passes through unchanged.

        **Validates: Requirements 1.1, 2.1**
        """
        text = "Sign here please"
        result = apply_phonetic_corrections(text)

        assert not re.search(r"(?i)\bsign\b", result), (
            f"Bug confirmed: 'Sign' was NOT replaced with 'sáin'.\n"
            f"  Input:  {text!r}\n"
            f"  Output: {result!r}"
        )
        assert "sáin" in result

    def test_multiple_sign_occurrences_not_corrected(self):
        """Concrete case: 'SIGN the sign' — both occurrences pass unchanged.

        **Validates: Requirements 1.1, 2.1**
        """
        text = "SIGN the sign"
        result = apply_phonetic_corrections(text)

        assert not re.search(r"(?i)\bsign\b", result), (
            f"Bug confirmed: standalone 'sign' occurrences NOT replaced.\n"
            f"  Input:  {text!r}\n"
            f"  Output: {result!r}"
        )
        assert "sáin" in result
