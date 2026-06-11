"""Unit tests for the pure helper functions in pdf_eng/manual_builder.py.

Feature: manual-builder-improvements
Requirements: 1.5, 5.1, 5.2, 5.3, 5.4
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

# Ensure the repository root is on sys.path *before* any pdf_eng import so
# that the real pdf_eng package (at <repo>/pdf_eng/) is resolved, not the
# test helper package at tests/pdf_eng/ which lacks manual_builder.
_REPO_ROOT = str(Path(__file__).resolve().parent.parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

# If tests/pdf_eng was already registered in sys.modules as "pdf_eng" (e.g.
# because pytest imported tests/pdf_eng/__init__.py first), evict it so the
# import below picks up the real package from the repo root.
if "pdf_eng" in sys.modules and not hasattr(sys.modules["pdf_eng"], "manual_builder"):
    del sys.modules["pdf_eng"]

import pytest

from pdf_eng.manual_builder import (
    VALID_LAYOUTS,
    _filter_step,
    _is_special_step,
    _scale_image,
    _validate_layout,
)


# ---------------------------------------------------------------------------
# _scale_image
# ---------------------------------------------------------------------------

class TestScaleImage:
    """Tests for _scale_image(orig_w, orig_h, max_w, max_h) -> (w, h)."""

    def test_image_fits_within_limits_unchanged(self):
        """Image smaller than limits is returned at its original size."""
        w, h = _scale_image(100, 50, 200, 200)
        assert w == 100
        assert h == 50

    def test_image_exactly_at_limits_unchanged(self):
        """Image that exactly matches the limits is returned unchanged."""
        w, h = _scale_image(200, 100, 200, 100)
        assert w == 200
        assert h == 100

    def test_scale_down_width_constrained(self):
        """Wide image is scaled down to fit max_w, preserving aspect ratio."""
        w, h = _scale_image(400, 200, 200, 300)
        assert w == pytest.approx(200.0)
        assert h == pytest.approx(100.0)

    def test_scale_down_height_constrained(self):
        """Tall image is scaled down to fit max_h, preserving aspect ratio."""
        w, h = _scale_image(100, 400, 300, 200)
        assert w == pytest.approx(50.0)
        assert h == pytest.approx(200.0)

    def test_never_upscales(self):
        """Small image must not be enlarged even when limits are larger."""
        w, h = _scale_image(10, 5, 500, 500)
        assert w == 10
        assert h == 5

    def test_aspect_ratio_preserved_wide(self):
        """Aspect ratio (w/h) is preserved after scaling a wide image."""
        orig_ratio = 16 / 9
        w, h = _scale_image(1600, 900, 400, 400)
        assert w / h == pytest.approx(orig_ratio, rel=1e-6)

    def test_aspect_ratio_preserved_tall(self):
        """Aspect ratio (w/h) is preserved after scaling a tall image."""
        orig_ratio = 3 / 4
        w, h = _scale_image(300, 400, 100, 200)
        assert w / h == pytest.approx(orig_ratio, rel=1e-6)

    def test_result_within_max_bounds(self):
        """Result dimensions are always within the specified limits."""
        w, h = _scale_image(1920, 1080, 15 * 28.35, 10 * 28.35)  # approx cm in pt
        assert w <= 15 * 28.35 + 1e-9
        assert h <= 10 * 28.35 + 1e-9

    def test_square_image_constrained_equally(self):
        """Square image constrained by square limits produces a square result."""
        w, h = _scale_image(500, 500, 100, 100)
        assert w == pytest.approx(100.0)
        assert h == pytest.approx(100.0)


# ---------------------------------------------------------------------------
# _validate_layout
# ---------------------------------------------------------------------------

class TestValidateLayout:
    """Tests for _validate_layout(layout: str) -> str."""

    def test_apostila_is_valid(self):
        assert _validate_layout("apostila") == "apostila"

    def test_playbook_is_valid(self):
        assert _validate_layout("playbook") == "playbook"

    def test_invalid_string_falls_back_to_apostila(self):
        assert _validate_layout("landscape") == "apostila"

    def test_empty_string_falls_back_to_apostila(self):
        assert _validate_layout("") == "apostila"

    def test_uppercase_falls_back_to_apostila(self):
        """Layout matching is case-sensitive; 'Apostila' is not valid."""
        assert _validate_layout("Apostila") == "apostila"

    def test_invalid_layout_logs_warning(self, caplog):
        """An invalid layout must produce a warning log containing the bad value."""
        with caplog.at_level(logging.WARNING, logger="pdf_eng.manual_builder"):
            _validate_layout("invalid_layout")
        assert "invalid_layout" in caplog.text

    def test_valid_layouts_do_not_log_warning(self, caplog):
        """Valid layouts must not produce any warning log."""
        with caplog.at_level(logging.WARNING, logger="pdf_eng.manual_builder"):
            _validate_layout("apostila")
            _validate_layout("playbook")
        assert caplog.text == ""

    def test_all_valid_layouts_covered(self):
        """Every value in VALID_LAYOUTS passes through unchanged."""
        for layout in VALID_LAYOUTS:
            assert _validate_layout(layout) == layout


# ---------------------------------------------------------------------------
# _is_special_step
# ---------------------------------------------------------------------------

class TestIsSpecialStep:
    """Tests for _is_special_step(passo: dict) -> bool."""

    def test_passo_0_is_special(self):
        assert _is_special_step({"passo": 0}) is True

    def test_passo_999_is_special(self):
        assert _is_special_step({"passo": 999}) is True

    def test_regular_step_is_not_special(self):
        for num in (1, 2, 50, 100, 500, 998):
            assert _is_special_step({"passo": num}) is False

    def test_missing_passo_key_treated_as_zero(self):
        """A step dict without 'passo' key defaults to 0 (special)."""
        assert _is_special_step({}) is True


# ---------------------------------------------------------------------------
# _filter_step
# ---------------------------------------------------------------------------

class TestFilterStep:
    """Tests for _filter_step(passo: dict) -> bool.

    True means the step should be IGNORED (has no useful content).
    """

    # --- Special steps (0 and 999) ---

    def test_special_step_with_ancora_is_kept(self):
        """Step 0/999 with a non-empty ancora must NOT be filtered out."""
        assert _filter_step({"passo": 0, "ancora": "Introdução"}) is False
        assert _filter_step({"passo": 999, "ancora": "Conclusão"}) is False

    def test_special_step_with_empty_ancora_is_filtered(self):
        """Step 0/999 with empty ancora must be ignored."""
        assert _filter_step({"passo": 0, "ancora": ""}) is True
        assert _filter_step({"passo": 999, "ancora": ""}) is True

    def test_special_step_with_whitespace_ancora_is_filtered(self):
        """Step 0/999 with whitespace-only ancora must be ignored."""
        assert _filter_step({"passo": 0, "ancora": "   "}) is True
        assert _filter_step({"passo": 999, "ancora": "\t\n"}) is True

    def test_special_step_with_none_ancora_is_filtered(self):
        """Step 0/999 with None ancora must be ignored."""
        assert _filter_step({"passo": 0, "ancora": None}) is True
        assert _filter_step({"passo": 999, "ancora": None}) is True

    def test_special_step_missing_ancora_is_filtered(self):
        """Step 0/999 without any 'ancora' key must be ignored."""
        assert _filter_step({"passo": 0}) is True
        assert _filter_step({"passo": 999}) is True

    # --- Regular steps ---

    def test_regular_step_with_both_fields_is_kept(self):
        """Regular step with ancora and micro_narracao must NOT be filtered."""
        passo = {"passo": 1, "ancora": "Clique aqui", "micro_narracao": "Clique no botão"}
        assert _filter_step(passo) is False

    def test_regular_step_with_only_ancora_is_kept(self):
        """Regular step with only ancora (micro empty) must NOT be filtered."""
        passo = {"passo": 2, "ancora": "Alguma âncora", "micro_narracao": ""}
        assert _filter_step(passo) is False

    def test_regular_step_with_only_micro_is_kept(self):
        """Regular step with only micro_narracao (ancora empty) must NOT be filtered."""
        passo = {"passo": 3, "ancora": "", "micro_narracao": "Alguma narração"}
        assert _filter_step(passo) is False

    def test_regular_step_with_both_empty_is_filtered(self):
        """Regular step with both ancora and micro_narracao empty must be ignored."""
        passo = {"passo": 4, "ancora": "", "micro_narracao": ""}
        assert _filter_step(passo) is True

    def test_regular_step_with_both_whitespace_is_filtered(self):
        """Regular step with whitespace-only fields must be ignored."""
        passo = {"passo": 5, "ancora": "   ", "micro_narracao": "\t"}
        assert _filter_step(passo) is True

    def test_regular_step_missing_both_fields_is_filtered(self):
        """Regular step with no text fields at all must be ignored."""
        assert _filter_step({"passo": 6}) is True

    def test_regular_step_with_none_fields_is_filtered(self):
        """Regular step where both fields are None must be ignored."""
        passo = {"passo": 7, "ancora": None, "micro_narracao": None}
        assert _filter_step(passo) is True


# ---------------------------------------------------------------------------
# _load_logo
# ---------------------------------------------------------------------------

import io
import os
import tempfile

from reportlab.platypus import Image as RLImage

from pdf_eng.manual_builder import _load_logo, LOGO_COVER_MAX_W, LOGO_COVER_MAX_H


def _create_valid_png(path: str, width: int = 100, height: int = 80) -> None:
    """Write a minimal valid PNG file to *path* using Pillow."""
    from PIL import Image as PILImage

    img = PILImage.new("RGB", (width, height), color=(255, 0, 0))
    img.save(path, format="PNG")


class TestLoadLogo:
    """Tests for _load_logo(logo_path, max_w, max_h) -> Image | None.

    Requirements: 2.4, 2.5, 2.7, 3.6
    """

    # --- None path ---

    def test_none_logo_path_returns_none_silently(self, caplog):
        """logo_path=None must return None without any warning."""
        with caplog.at_level(logging.WARNING, logger="pdf_eng.manual_builder"):
            result = _load_logo(None, LOGO_COVER_MAX_W, LOGO_COVER_MAX_H)
        assert result is None
        assert caplog.text == ""

    # --- File not found ---

    def test_missing_file_returns_none_and_logs_warning(self, caplog, tmp_path):
        """Non-existent file must return None and log a warning with the path."""
        missing = str(tmp_path / "does_not_exist.png")
        with caplog.at_level(logging.WARNING, logger="pdf_eng.manual_builder"):
            result = _load_logo(missing, LOGO_COVER_MAX_W, LOGO_COVER_MAX_H)
        assert result is None
        assert missing in caplog.text

    # --- Unsupported / unreadable format ---

    def test_invalid_format_returns_none_and_logs_warning(self, caplog, tmp_path):
        """A file with non-image content must return None and log a warning."""
        bad_file = tmp_path / "not_an_image.png"
        bad_file.write_bytes(b"this is not an image at all")
        with caplog.at_level(logging.WARNING, logger="pdf_eng.manual_builder"):
            result = _load_logo(str(bad_file), LOGO_COVER_MAX_W, LOGO_COVER_MAX_H)
        assert result is None
        assert caplog.text != ""

    # --- Valid logo ---

    def test_valid_png_returns_reportlab_image(self, tmp_path):
        """A valid PNG file must return a reportlab Image object."""
        logo = tmp_path / "logo.png"
        _create_valid_png(str(logo), width=200, height=100)
        result = _load_logo(str(logo), LOGO_COVER_MAX_W, LOGO_COVER_MAX_H)
        assert isinstance(result, RLImage)

    def test_valid_logo_respects_max_dimensions(self, tmp_path):
        """Result Image dimensions must not exceed the specified max bounds."""
        logo = tmp_path / "big_logo.png"
        _create_valid_png(str(logo), width=1000, height=800)
        result = _load_logo(str(logo), LOGO_COVER_MAX_W, LOGO_COVER_MAX_H)
        assert result is not None
        assert result.drawWidth <= LOGO_COVER_MAX_W + 1e-6
        assert result.drawHeight <= LOGO_COVER_MAX_H + 1e-6

    def test_small_logo_not_upscaled(self, tmp_path):
        """An image already smaller than the limits must not be enlarged."""
        from reportlab.lib.units import cm

        small_max_w = 5 * cm
        small_max_h = 5 * cm
        logo = tmp_path / "tiny_logo.png"
        # 10×5 pt image — tiny, well within 5 cm limits
        _create_valid_png(str(logo), width=10, height=5)
        result = _load_logo(str(logo), small_max_w, small_max_h)
        assert result is not None
        # Should not be larger than original (10 px ≈ 10 pt)
        assert result.drawWidth <= 10 + 1e-6
        assert result.drawHeight <= 5 + 1e-6

    def test_valid_logo_no_warning_logged(self, caplog, tmp_path):
        """A successfully loaded logo must not produce any warning."""
        logo = tmp_path / "logo_ok.png"
        _create_valid_png(str(logo))
        with caplog.at_level(logging.WARNING, logger="pdf_eng.manual_builder"):
            _load_logo(str(logo), LOGO_COVER_MAX_W, LOGO_COVER_MAX_H)
        assert caplog.text == ""
