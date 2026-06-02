"""Bug-condition exploration test — Property 7: AI SDK Currency.

Production-hardening bugfix spec, Task 4.

**Property 7 (design.md): Bug Condition — AI SDK Currency**
> For any AI-pipeline invocation where the bug condition holds because the
> obsolete ``google-genai==0.3.0`` SDK is resolved (C6), the fixed system SHALL
> depend on a supported current ``google-genai`` version with the referenced
> Gemini model usage verified to work against that version.

**Validates: Requirements 1.6, 2.6**

Bug condition (design Bug Details):
``C6(X): X runs the AI pipeline AND the resolved google-genai SDK is the
obsolete 0.3.0 pin``.

This is the *deterministic facet* of the property (the input space collapses to
the single concrete failing case), so it is encoded as plain deterministic
assertions rather than a Hypothesis strategy:

1. The ``google-genai`` requirement declared in ``requirements.txt`` (the
   version a clean ``pip install`` resolves) must be a supported current
   ``1.x`` line — NOT the obsolete ``0.3.0`` pin.
2. The Gemini call sites in ``api/intelligence_engine.py`` must use an API
   surface that is verified to work against the current SDK.

CRITICAL: This test MUST FAIL on unfixed code (``requirements.txt`` pins
``google-genai==0.3.0``). The failure confirms the bug exists. It is NOT to be
"fixed" here — it becomes the fix-checking test that passes after task 13.1
bumps the SDK.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional, Tuple

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
REQUIREMENTS = REPO_ROOT / "requirements.txt"
INTELLIGENCE_ENGINE = REPO_ROOT / "api" / "intelligence_engine.py"

# The obsolete pin that defines the C6 bug condition.
OBSOLETE_PIN = (0, 3, 0)
# Minimum supported current major line for google-genai.
MIN_SUPPORTED_MAJOR = 1


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _read_requirement_spec(package: str) -> Optional[str]:
    """Return the raw requirement line value for ``package`` from requirements.txt.

    e.g. for ``google-genai==0.3.0`` returns ``"==0.3.0"``. Returns ``None`` if
    the package is not declared. Matching is case-insensitive and tolerant of
    ``-``/``_`` and surrounding whitespace, mirroring pip's name normalization.
    """
    if not REQUIREMENTS.exists():
        return None

    norm_target = package.lower().replace("_", "-")
    name_re = re.compile(r"^\s*([A-Za-z0-9._-]+)\s*(.*)$")

    for raw in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        match = name_re.match(line)
        if not match:
            continue
        name, spec = match.group(1), match.group(2).strip()
        if name.lower().replace("_", "-") == norm_target:
            return spec
    return None


def _extract_pinned_version(spec: str) -> Optional[Tuple[int, ...]]:
    """Extract a comparable version tuple from a requirement spec string.

    Handles the common forms used in this manifest, e.g. ``==0.3.0``,
    ``>=1.0.0``, ``~=1.69``. Returns ``None`` when no version is present.
    """
    version_match = re.search(r"(\d+(?:\.\d+)*)", spec)
    if not version_match:
        return None
    return tuple(int(part) for part in version_match.group(1).split("."))


# --------------------------------------------------------------------------- #
# C6 — deterministic facet: the declared SDK version must be current 1.x
# --------------------------------------------------------------------------- #
def test_google_genai_requirement_is_current_1x_not_obsolete_pin():
    """C6: the resolved google-genai pin must be a supported current 1.x.

    EXPECTED ON UNFIXED CODE: FAILS — ``requirements.txt`` pins
    ``google-genai==0.3.0`` (the obsolete line), so the resolved version is
    ``0.3.0`` and not a supported ``1.x``.

    Validates: Requirements 1.6, 2.6 (design Property 7).
    """
    spec = _read_requirement_spec("google-genai")
    assert spec is not None, (
        "google-genai is not declared in requirements.txt at all — the AI "
        "pipeline depends on it (api/intelligence_engine.py imports `from "
        "google import genai`)."
    )

    version = _extract_pinned_version(spec)
    assert version is not None, (
        f"Could not parse a version from the google-genai requirement spec "
        f"{spec!r}."
    )

    # The C6 bug condition: the obsolete 0.3.0 pin is resolved.
    assert version[:3] != OBSOLETE_PIN, (
        f"C6 bug condition present: requirements.txt resolves "
        f"google-genai{spec} (the obsolete 0.3.0 pin). It must be bumped to a "
        f"supported current 1.x line (per Expected Behavior 2.6)."
    )

    # Stronger form of the same property: must be on (or above) the current
    # 1.x major line.
    assert version[0] >= MIN_SUPPORTED_MAJOR, (
        f"google-genai is pinned to {version[0]}.x via {spec!r}; the AI "
        f"pipeline requires a supported current >= {MIN_SUPPORTED_MAJOR}.x SDK "
        f"(Gemini 2.5 Flash usage in api/intelligence_engine.py is written "
        f"against the new unified SDK surface)."
    )


def test_gemini_call_sites_use_current_sdk_api_surface():
    """C6: the Gemini call sites must use a surface compatible with the current SDK.

    The referenced Gemini 2.5 Flash usage in ``api/intelligence_engine.py`` must
    be verified to work against the current ``google-genai`` SDK. The current
    (1.x) unified SDK uses ``genai.Client(...)`` +
    ``client.aio.models.generate_content(...)`` with keyword-form
    ``types.Part.from_text(text=...)``; the obsolete 0.3.0 line used a different,
    incompatible surface.

    This asserts the source declares the model and uses the current-surface
    calls, so that once the SDK is bumped (task 13.1) the usage is confirmed
    compatible rather than silently broken.

    Validates: Requirements 1.6, 2.6 (design Property 7).
    """
    assert INTELLIGENCE_ENGINE.exists(), (
        "api/intelligence_engine.py is missing — it is the primary genai call "
        "site for the AI pipeline."
    )
    source = INTELLIGENCE_ENGINE.read_text(encoding="utf-8")

    # The referenced Gemini model must be present at the call sites.
    assert "gemini-2.5-flash" in source, (
        "Expected the referenced Gemini 2.5 Flash model at the call sites."
    )

    # Current unified-SDK surface markers.
    assert "genai.Client(" in source, (
        "Expected the current SDK client constructor `genai.Client(...)` at the "
        "call sites."
    )
    assert "client.aio.models.generate_content(" in source, (
        "Expected the current SDK async call "
        "`client.aio.models.generate_content(...)` at the call sites."
    )

    # The current SDK must actually expose that surface — verifies the call
    # sites work against the resolved (current) SDK. This makes the property
    # meaningful: the declared pin (asserted above) and the runtime surface
    # must agree.
    genai = pytest.importorskip(
        "google.genai", reason="google-genai must be installed to verify the call surface"
    )
    from google.genai import types as genai_types

    assert hasattr(genai, "Client"), "current google-genai SDK must expose genai.Client"
    assert hasattr(genai_types, "Part"), "current google-genai SDK must expose types.Part"
    assert hasattr(genai_types, "GenerateContentConfig"), (
        "current google-genai SDK must expose types.GenerateContentConfig"
    )
