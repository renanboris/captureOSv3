"""Unit tests for ScormBuilder.build() quiz integration — task 7.4.

Verifies:
- _generate_quiz() is awaited when incluir_quiz=True
- quiz.js is written to ZIP when questions are returned
- imsmanifest.xml includes <file href="data/quiz.js"/> when questions exist
- Package is generated without quiz.js when incluir_quiz=False
- Package is generated without quiz.js when _generate_quiz returns empty list
- gerar_scorm() is async and delegates to ScormBuilder.build()

Requirements: 4.1, 4.2, 4.3, 4.7
"""

import asyncio
import json
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from contracts.simlink_models import SimlinkModulo
from scorm_eng.scorm_builder import ScormBuilder, gerar_scorm


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def minimal_modulo() -> SimlinkModulo:
    """Minimal valid SimlinkModulo for tests."""
    return SimlinkModulo(
        modulo_id="build_test",
        session_id="build_test",
        titulo="Build Test Module",
        dominio="exemplo.com.br",
        total_passos=1,
        hotspots=[
            {
                "passo_num": 1,
                "xpath": "//button[1]",
                "css_selector": "button.step-1",
                "coordinates": {"x": 10.0, "y": 20.0, "w": 100.0, "h": 30.0},
                "target_text": "Click me",
                "action": "click",
                "url": "https://exemplo.com.br/app",
                "screenshot_path": "data/simlink_screenshots/build_test/passo_1.png",
                "ancora": "Boa!",
                "micro_narracao": "Tente clicar aqui.",
                "audio_path": None,
            }
        ],
        video_url="http://localhost:8000/videos_gerados/build_test_final.mp4",
        xp_max=10,
        criado_em="2024-01-01T00:00:00",
    )


@pytest.fixture
def sample_quiz_data() -> list:
    """Sample quiz questions matching the expected schema."""
    return [
        {
            "pergunta": "Qual é o objetivo do botão Salvar?",
            "opcoes": [
                "Persistir os dados",
                "Fechar o formulário",
                "Apagar os dados",
                "Enviar email",
            ],
            "correta": 0,
            "explicacao": "O botão Salvar persiste os dados no sistema.",
        },
        {
            "pergunta": "Como cancelar a operação?",
            "opcoes": [
                "Clicar em Salvar",
                "Clicar em Cancelar",
                "Fechar o navegador",
                "Pressionar Enter",
            ],
            "correta": 1,
            "explicacao": "Clicar em Cancelar descarta as alterações.",
        },
    ]


@pytest.fixture
def builder_with_quiz(minimal_modulo, tmp_path) -> ScormBuilder:
    """ScormBuilder instance configured with incluir_quiz=True, output in tmp_path."""
    builder = ScormBuilder(
        minimal_modulo,
        "build_test",
        "Build Test Module",
        incluir_quiz=True,
        num_questoes_quiz=2,
    )
    builder.output_base = tmp_path
    return builder


@pytest.fixture
def builder_without_quiz(minimal_modulo, tmp_path) -> ScormBuilder:
    """ScormBuilder instance configured with incluir_quiz=False, output in tmp_path."""
    builder = ScormBuilder(
        minimal_modulo,
        "build_test",
        "Build Test Module",
        incluir_quiz=False,
    )
    builder.output_base = tmp_path
    return builder


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _patch_templates(builder: ScormBuilder):
    """Return a context manager that makes _write_assets/_write_templates no-ops.

    We patch the os.walk call used for templates and the screenshots directory
    so tests don't depend on filesystem layout outside the tmp_path.
    """
    # We mock os.walk to return nothing for templates dir
    return patch("os.walk", return_value=iter([]))


def run(coro):
    """Run an async coroutine synchronously for tests."""
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# build() — quiz NOT requested (incluir_quiz=False)
# ---------------------------------------------------------------------------

class TestBuildWithoutQuiz:
    def test_build_returns_zip_path(self, builder_without_quiz, tmp_path):
        with _patch_templates(builder_without_quiz):
            zip_path = run(builder_without_quiz.build())
        assert zip_path == str(tmp_path / "build_test.zip")

    def test_build_creates_zip_file(self, builder_without_quiz, tmp_path):
        with _patch_templates(builder_without_quiz):
            run(builder_without_quiz.build())
        assert (tmp_path / "build_test.zip").exists()

    def test_build_no_quiz_js_in_zip(self, builder_without_quiz, tmp_path):
        with _patch_templates(builder_without_quiz):
            run(builder_without_quiz.build())
        with zipfile.ZipFile(tmp_path / "build_test.zip") as zf:
            names = zf.namelist()
        assert "data/quiz.js" not in names

    def test_build_manifest_no_quiz_reference(self, builder_without_quiz, tmp_path):
        with _patch_templates(builder_without_quiz):
            run(builder_without_quiz.build())
        with zipfile.ZipFile(tmp_path / "build_test.zip") as zf:
            manifest = zf.read("imsmanifest.xml").decode("utf-8")
        assert "data/quiz.js" not in manifest

    def test_generate_quiz_not_called_when_incluir_quiz_false(
        self, builder_without_quiz, tmp_path
    ):
        with _patch_templates(builder_without_quiz), patch.object(
            builder_without_quiz, "_generate_quiz", new_callable=AsyncMock
        ) as mock_gen:
            run(builder_without_quiz.build())
        mock_gen.assert_not_called()


# ---------------------------------------------------------------------------
# build() — quiz requested but _generate_quiz returns empty list
# ---------------------------------------------------------------------------

class TestBuildQuizRequestedButEmpty:
    def test_build_completes_without_quiz_js(self, builder_with_quiz, tmp_path):
        with _patch_templates(builder_with_quiz), patch.object(
            builder_with_quiz, "_generate_quiz", new_callable=AsyncMock, return_value=[]
        ):
            run(builder_with_quiz.build())
        with zipfile.ZipFile(tmp_path / "build_test.zip") as zf:
            names = zf.namelist()
        assert "data/quiz.js" not in names

    def test_manifest_has_no_quiz_reference_when_empty(self, builder_with_quiz, tmp_path):
        with _patch_templates(builder_with_quiz), patch.object(
            builder_with_quiz, "_generate_quiz", new_callable=AsyncMock, return_value=[]
        ):
            run(builder_with_quiz.build())
        with zipfile.ZipFile(tmp_path / "build_test.zip") as zf:
            manifest = zf.read("imsmanifest.xml").decode("utf-8")
        assert "data/quiz.js" not in manifest

    def test_generate_quiz_is_called_when_incluir_quiz_true(
        self, builder_with_quiz, tmp_path
    ):
        with _patch_templates(builder_with_quiz), patch.object(
            builder_with_quiz, "_generate_quiz", new_callable=AsyncMock, return_value=[]
        ) as mock_gen:
            run(builder_with_quiz.build())
        mock_gen.assert_awaited_once()


# ---------------------------------------------------------------------------
# build() — quiz requested and questions returned
# ---------------------------------------------------------------------------

class TestBuildWithQuizQuestions:
    def test_quiz_js_written_to_zip(self, builder_with_quiz, tmp_path, sample_quiz_data):
        with _patch_templates(builder_with_quiz), patch.object(
            builder_with_quiz,
            "_generate_quiz",
            new_callable=AsyncMock,
            return_value=sample_quiz_data,
        ):
            run(builder_with_quiz.build())
        with zipfile.ZipFile(tmp_path / "build_test.zip") as zf:
            assert "data/quiz.js" in zf.namelist()

    def test_quiz_js_content_is_valid_js(self, builder_with_quiz, tmp_path, sample_quiz_data):
        with _patch_templates(builder_with_quiz), patch.object(
            builder_with_quiz,
            "_generate_quiz",
            new_callable=AsyncMock,
            return_value=sample_quiz_data,
        ):
            run(builder_with_quiz.build())
        with zipfile.ZipFile(tmp_path / "build_test.zip") as zf:
            content = zf.read("data/quiz.js").decode("utf-8")
        assert content.startswith("const QUIZ_DATA = ")
        assert content.endswith(";")

    def test_quiz_js_contains_correct_data(
        self, builder_with_quiz, tmp_path, sample_quiz_data
    ):
        with _patch_templates(builder_with_quiz), patch.object(
            builder_with_quiz,
            "_generate_quiz",
            new_callable=AsyncMock,
            return_value=sample_quiz_data,
        ):
            run(builder_with_quiz.build())
        with zipfile.ZipFile(tmp_path / "build_test.zip") as zf:
            content = zf.read("data/quiz.js").decode("utf-8")
        # Strip JS assignment wrapper and parse JSON
        json_part = content.removeprefix("const QUIZ_DATA = ").removesuffix(";")
        parsed = json.loads(json_part)
        assert parsed == sample_quiz_data

    def test_manifest_includes_quiz_js_reference(
        self, builder_with_quiz, tmp_path, sample_quiz_data
    ):
        with _patch_templates(builder_with_quiz), patch.object(
            builder_with_quiz,
            "_generate_quiz",
            new_callable=AsyncMock,
            return_value=sample_quiz_data,
        ):
            run(builder_with_quiz.build())
        with zipfile.ZipFile(tmp_path / "build_test.zip") as zf:
            manifest = zf.read("imsmanifest.xml").decode("utf-8")
        assert '<file href="data/quiz.js"/>' in manifest

    def test_manifest_also_contains_standard_files(
        self, builder_with_quiz, tmp_path, sample_quiz_data
    ):
        """Standard manifest entries must be present even when quiz is included."""
        with _patch_templates(builder_with_quiz), patch.object(
            builder_with_quiz,
            "_generate_quiz",
            new_callable=AsyncMock,
            return_value=sample_quiz_data,
        ):
            run(builder_with_quiz.build())
        with zipfile.ZipFile(tmp_path / "build_test.zip") as zf:
            manifest = zf.read("imsmanifest.xml").decode("utf-8")
        assert '<file href="index.html"/>' in manifest
        assert '<file href="data/steps.js"/>' in manifest
        assert "ADL SCORM" in manifest

    def test_steps_js_always_written(self, builder_with_quiz, tmp_path, sample_quiz_data):
        with _patch_templates(builder_with_quiz), patch.object(
            builder_with_quiz,
            "_generate_quiz",
            new_callable=AsyncMock,
            return_value=sample_quiz_data,
        ):
            run(builder_with_quiz.build())
        with zipfile.ZipFile(tmp_path / "build_test.zip") as zf:
            assert "data/steps.js" in zf.namelist()

    def test_generate_quiz_awaited_once(
        self, builder_with_quiz, tmp_path, sample_quiz_data
    ):
        with _patch_templates(builder_with_quiz), patch.object(
            builder_with_quiz,
            "_generate_quiz",
            new_callable=AsyncMock,
            return_value=sample_quiz_data,
        ) as mock_gen:
            run(builder_with_quiz.build())
        mock_gen.assert_awaited_once()


# ---------------------------------------------------------------------------
# _gerar_manifest — unit tests for conditional quiz.js reference
# ---------------------------------------------------------------------------

class TestGerarManifest:
    def test_manifest_without_quiz(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título")
        manifest = builder._gerar_manifest(include_quiz=False)
        assert "data/quiz.js" not in manifest

    def test_manifest_with_quiz(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título")
        manifest = builder._gerar_manifest(include_quiz=True)
        assert '<file href="data/quiz.js"/>' in manifest

    def test_manifest_default_excludes_quiz(self, minimal_modulo):
        builder = ScormBuilder(minimal_modulo, "sess1", "Título")
        manifest = builder._gerar_manifest()
        assert "data/quiz.js" not in manifest

    def test_manifest_is_valid_xml_with_quiz(self, minimal_modulo):
        import xml.etree.ElementTree as ET
        builder = ScormBuilder(minimal_modulo, "sess1", "Título")
        manifest = builder._gerar_manifest(include_quiz=True)
        # Should not raise
        ET.fromstring(manifest)

    def test_manifest_is_valid_xml_without_quiz(self, minimal_modulo):
        import xml.etree.ElementTree as ET
        builder = ScormBuilder(minimal_modulo, "sess1", "Título")
        manifest = builder._gerar_manifest(include_quiz=False)
        ET.fromstring(manifest)


# ---------------------------------------------------------------------------
# gerar_scorm() — async wrapper
# ---------------------------------------------------------------------------

class TestGerarScorm:
    def test_gerar_scorm_is_coroutine(self, minimal_modulo):
        """gerar_scorm must be async (returns a coroutine)."""
        coro = gerar_scorm(minimal_modulo, "sess1", "Título")
        assert asyncio.iscoroutine(coro)
        coro.close()  # Clean up without running

    def test_gerar_scorm_delegates_to_build(self, minimal_modulo, tmp_path):
        """gerar_scorm should produce a zip at the expected path."""
        with patch("scorm_eng.scorm_builder.ScormBuilder.build", new_callable=AsyncMock) as mock_build:
            mock_build.return_value = str(tmp_path / "sess1.zip")
            result = run(
                gerar_scorm(minimal_modulo, "sess1", "Título")
            )
        mock_build.assert_awaited_once()
        assert result == str(tmp_path / "sess1.zip")

    def test_gerar_scorm_passes_incluir_quiz_param(self, minimal_modulo):
        """incluir_quiz parameter must be forwarded to ScormBuilder."""
        captured = {}

        original_init = ScormBuilder.__init__

        def capturing_init(self, modulo, session_id, titulo, incluir_quiz=False, num_questoes_quiz=3):
            captured["incluir_quiz"] = incluir_quiz
            original_init(self, modulo, session_id, titulo, incluir_quiz, num_questoes_quiz)

        with patch("scorm_eng.scorm_builder.ScormBuilder.__init__", capturing_init), \
             patch("scorm_eng.scorm_builder.ScormBuilder.build", new_callable=AsyncMock, return_value="x.zip"):
            run(gerar_scorm(minimal_modulo, "sess1", "Título", incluir_quiz=True))

        assert captured["incluir_quiz"] is True

    def test_gerar_scorm_passes_num_questoes_param(self, minimal_modulo):
        """num_questoes_quiz parameter must be forwarded to ScormBuilder."""
        captured = {}

        original_init = ScormBuilder.__init__

        def capturing_init(self, modulo, session_id, titulo, incluir_quiz=False, num_questoes_quiz=3):
            captured["num_questoes_quiz"] = num_questoes_quiz
            original_init(self, modulo, session_id, titulo, incluir_quiz, num_questoes_quiz)

        with patch("scorm_eng.scorm_builder.ScormBuilder.__init__", capturing_init), \
             patch("scorm_eng.scorm_builder.ScormBuilder.build", new_callable=AsyncMock, return_value="x.zip"):
            run(gerar_scorm(minimal_modulo, "sess1", "Título", num_questoes_quiz=7))

        assert captured["num_questoes_quiz"] == 7
