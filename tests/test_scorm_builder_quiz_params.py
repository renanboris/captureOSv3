"""Unit tests for ScormBuilder quiz parameter handling.

Tests validate task 7.1:
- incluir_quiz and num_questoes_quiz parameters added to __init__
- _validate_num_questoes clamps values to [1, 10] range
- Warnings logged for out-of-range values

Requirements: 4.1, 7.1, 7.2, 7.3, 7.4
"""

import logging
import pytest
from contracts.simlink_models import SimlinkModulo
from scorm_eng.scorm_builder import ScormBuilder


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def minimal_modulo() -> SimlinkModulo:
    """Minimal valid SimlinkModulo for constructing ScormBuilder instances."""
    return SimlinkModulo(
        modulo_id="test_session",
        session_id="test_session",
        titulo="Módulo de Teste",
        dominio="exemplo.com.br",
        total_passos=1,
        hotspots=[
            {
                "passo_num": 1,
                "xpath": "//button[1]",
                "css_selector": "button.step-1",
                "coordinates": {"x": 10.0, "y": 20.0, "w": 100.0, "h": 30.0},
                "target_text": "Passo 1",
                "action": "click",
                "url": "https://exemplo.com.br/app",
                "screenshot_path": "data/simlink_screenshots/test_session/passo_1.png",
                "ancora": "Boa!",
                "micro_narracao": "Tente clicar aqui.",
                "audio_path": None,
            }
        ],
        video_url="http://localhost:8000/videos_gerados/test_final.mp4",
        xp_max=10,
        criado_em="2024-01-01T00:00:00",
    )


# ---------------------------------------------------------------------------
# Default parameter values
# ---------------------------------------------------------------------------

class TestDefaultParameters:
    def test_incluir_quiz_defaults_to_false(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título")
        assert builder.incluir_quiz is False

    def test_num_questoes_defaults_to_3(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título")
        assert builder.num_questoes_quiz == 3


# ---------------------------------------------------------------------------
# incluir_quiz parameter
# ---------------------------------------------------------------------------

class TestIncluirQuizParameter:
    def test_incluir_quiz_true_stored(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título", incluir_quiz=True)
        assert builder.incluir_quiz is True

    def test_incluir_quiz_false_stored(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título", incluir_quiz=False)
        assert builder.incluir_quiz is False


# ---------------------------------------------------------------------------
# _validate_num_questoes – valid range
# ---------------------------------------------------------------------------

class TestValidateNumQuestoes:
    @pytest.mark.parametrize("valid_value", [1, 2, 3, 5, 7, 10])
    def test_valid_values_stored_as_is(self, minimal_modulo, valid_value):
        builder = ScormBuilder(
            minimal_modulo, "sess1", "Título", num_questoes_quiz=valid_value
        )
        assert builder.num_questoes_quiz == valid_value

    def test_lower_boundary_1_accepted(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título", num_questoes_quiz=1)
        assert builder.num_questoes_quiz == 1

    def test_upper_boundary_10_accepted(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título", num_questoes_quiz=10)
        assert builder.num_questoes_quiz == 10


# ---------------------------------------------------------------------------
# _validate_num_questoes – out-of-range clamping
# ---------------------------------------------------------------------------

class TestValidateNumQuestoesOutOfRange:
    @pytest.mark.parametrize("invalid_value", [0, -1, -100, 11, 50, 999])
    def test_out_of_range_returns_default_3(self, minimal_modulo, invalid_value):
        builder = ScormBuilder(
            minimal_modulo, "sess1", "Título", num_questoes_quiz=invalid_value
        )
        assert builder.num_questoes_quiz == 3

    @pytest.mark.parametrize("invalid_value", [0, -1, 11, 100])
    def test_out_of_range_logs_warning(self, minimal_modulo, invalid_value, caplog):
        with caplog.at_level(logging.WARNING, logger="scorm_eng.scorm_builder"):
            ScormBuilder(
                minimal_modulo, "sess1", "Título", num_questoes_quiz=invalid_value
            )
        assert any(
            "num_questoes_quiz" in record.message and str(invalid_value) in record.message
            for record in caplog.records
        ), f"Expected warning mentioning num_questoes_quiz={invalid_value}"

    def test_zero_returns_default_3(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título", num_questoes_quiz=0)
        assert builder.num_questoes_quiz == 3

    def test_above_10_returns_default_3(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título", num_questoes_quiz=11)
        assert builder.num_questoes_quiz == 3

    def test_no_warning_for_valid_value(self, minimal_modulo, caplog):
        with caplog.at_level(logging.WARNING, logger="scorm_eng.scorm_builder"):
            ScormBuilder(minimal_modulo, "sess1", "Título", num_questoes_quiz=5)
        assert not any(
            "num_questoes_quiz" in record.message
            for record in caplog.records
        )


# ---------------------------------------------------------------------------
# Existing parameters unaffected
# ---------------------------------------------------------------------------

class TestExistingParametersUnaffected:
    def test_session_id_stored(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "my_session", "Título")
        assert builder.session_id == "my_session"

    def test_titulo_stored(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Meu Título")
        assert builder.titulo == "Meu Título"

    def test_simlink_modulo_stored(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título")
        assert builder.simlink_modulo is minimal_modulo
