"""Versioned prompt loader for the CaptureOS v3 AI agents.

The prompt *content* and voice live in the ``prompts/*.v1.txt`` files (the source
of truth). This module is purely the engineering "wiring" that turns those files
into the two strings each Gemini/OpenAI call needs:

* a ``system_instruction`` (the model's persona + rules), and
* a ``contents`` user template (the per-request dynamic data + output format).

File convention
---------------
Each *agent* prompt file uses two machine-readable delimiters on their own
lines::

    # ... human documentation header (stripped, never reaches the model) ...
    ===SYSTEM===
    <everything that becomes the model's system_instruction; [[INCLUDE]] allowed>
    ===USER===
    <the user-content template, with {variable} placeholders and JSON examples>

Rules implemented here
----------------------
* ``[[INCLUDE: relpath]]`` markers are inlined with the referenced file's text
  (resolved relative to ``prompts/``), recursively, with cycle protection.
* Everything BEFORE the first ``===SYSTEM===`` delimiter is treated as the
  human-authored documentation header and stripped — it never reaches the model.
  Everything after ``===SYSTEM===`` is real prompt content and is preserved
  verbatim (the agent files deliberately contain no ``#``-leading content there).
* Variable substitution is a *safe* token replace (``{key}`` -> value) so the
  JSON braces in the FORMATO DE SAÍDA examples are left untouched. ``str.format``
  is intentionally NOT used.
* File reads are cached (``functools.lru_cache``); :func:`clear_cache` resets it
  for tests.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

# The directory that holds the prompt files (this module lives in it).
PROMPTS_DIR = Path(__file__).resolve().parent

# Section delimiters (must appear on their own line).
SYSTEM_DELIMITER = "===SYSTEM==="
USER_DELIMITER = "===USER==="

# [[INCLUDE: relpath]] — relpath is resolved relative to PROMPTS_DIR.
_INCLUDE_RE = re.compile(r"^\s*\[\[INCLUDE:\s*(?P<path>.+?)\s*\]\]\s*$")


# --------------------------------------------------------------------------- #
# Exceptions
# --------------------------------------------------------------------------- #
class PromptError(Exception):
    """Base class for prompt loader errors."""


class PromptNotFoundError(PromptError, FileNotFoundError):
    """Raised when a prompt (or included) file cannot be found."""


class PromptCycleError(PromptError):
    """Raised when ``[[INCLUDE]]`` directives form a cycle."""


class PromptParseError(PromptError):
    """Raised when a prompt file is missing a required section delimiter."""


# --------------------------------------------------------------------------- #
# Parsed representation
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class PromptSections:
    """The system / user halves of a parsed agent prompt (raw, not substituted)."""

    system: str
    user: str


# --------------------------------------------------------------------------- #
# Name + path resolution
# --------------------------------------------------------------------------- #
def _resolve_relpath(name: str) -> str:
    """Map a prompt ``name`` to its file path relative to ``prompts/``.

    Accepts the name with or without an extension; defaults to ``.v1.txt`` when
    no ``.txt`` extension is present.

        "motor_intencao"            -> "motor_intencao.v1.txt"
        "motor_intencao.v1.txt"     -> "motor_intencao.v1.txt"
        "shared/_persona_aura.v1.txt" -> "shared/_persona_aura.v1.txt"
    """
    normalized = name.strip().replace("\\", "/")
    if normalized.endswith(".txt"):
        return normalized
    return f"{normalized}.v1.txt"


@lru_cache(maxsize=None)
def _read_raw(abs_path: str) -> str:
    """Read a prompt file from disk. Cached; reset via :func:`clear_cache`."""
    path = Path(abs_path)
    if not path.is_file():
        raise PromptNotFoundError(f"Prompt file not found: {abs_path}")
    return path.read_text(encoding="utf-8")


def clear_cache() -> None:
    """Clear the file-read cache (use in tests after editing prompt files)."""
    _read_raw.cache_clear()


# --------------------------------------------------------------------------- #
# Include resolution
# --------------------------------------------------------------------------- #
def _resolve_includes(text: str, _seen: List[str]) -> str:
    """Inline every ``[[INCLUDE: relpath]]`` directive, recursively.

    ``_seen`` is the stack of absolute paths currently being resolved; it guards
    against include cycles.
    """
    out_lines: List[str] = []
    for line in text.splitlines():
        match = _INCLUDE_RE.match(line)
        if not match:
            out_lines.append(line)
            continue

        rel = _resolve_relpath(match.group("path"))
        abs_path = str((PROMPTS_DIR / rel).resolve())
        if abs_path in _seen:
            chain = " -> ".join(_seen + [abs_path])
            raise PromptCycleError(f"Include cycle detected: {chain}")

        included = _read_raw(abs_path)
        resolved = _resolve_includes(included, _seen + [abs_path])
        out_lines.append(resolved)

    return "\n".join(out_lines)


# --------------------------------------------------------------------------- #
# Public: load + parse
# --------------------------------------------------------------------------- #
def load_prompt(name: str) -> str:
    """Return the full prompt text for ``name`` with all includes inlined.

    The documentation header (everything before ``===SYSTEM===``) is preserved
    here; section splitting/stripping happens in :func:`parse_prompt`.
    """
    rel = _resolve_relpath(name)
    abs_path = str((PROMPTS_DIR / rel).resolve())
    raw = _read_raw(abs_path)
    return _resolve_includes(raw, [abs_path])


def parse_prompt(name: str) -> PromptSections:
    """Parse ``name`` into its system / user sections (includes resolved).

    Everything before the first ``===SYSTEM===`` is the documentation header and
    is discarded. Content between ``===SYSTEM===`` and ``===USER===`` is the
    system instruction; content after ``===USER===`` is the user template.
    """
    full = load_prompt(name)
    lines = full.splitlines()

    system_idx = None
    user_idx = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if system_idx is None and stripped == SYSTEM_DELIMITER:
            system_idx = i
        elif system_idx is not None and user_idx is None and stripped == USER_DELIMITER:
            user_idx = i

    if system_idx is None:
        raise PromptParseError(
            f"Prompt {name!r} is missing the {SYSTEM_DELIMITER} delimiter."
        )

    if user_idx is None:
        system_lines = lines[system_idx + 1:]
        user_lines: List[str] = []
    else:
        system_lines = lines[system_idx + 1:user_idx]
        user_lines = lines[user_idx + 1:]

    return PromptSections(
        system="\n".join(system_lines).strip(),
        user="\n".join(user_lines).strip(),
    )


# --------------------------------------------------------------------------- #
# Public: render (variable substitution)
# --------------------------------------------------------------------------- #
def _substitute(text: str, variables: Dict[str, Any]) -> str:
    """Safely replace known ``{key}`` tokens; leave all other braces untouched.

    Intentionally avoids ``str.format`` so the JSON example braces in the
    FORMATO DE SAÍDA sections never raise. Missing/extra variables are no-ops.
    """
    for key, value in variables.items():
        text = text.replace("{" + key + "}", str(value))
    return text


def render_system(name: str, **variables: Any) -> str:
    """Build the model ``system_instruction`` text for ``name``."""
    return _substitute(parse_prompt(name).system, variables)


def render_user(name: str, **variables: Any) -> str:
    """Build the user-content (``contents``) text for ``name``."""
    return _substitute(parse_prompt(name).user, variables)
