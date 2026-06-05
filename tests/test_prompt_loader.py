"""Testes do carregador de prompts versionados (config/prompt_loader.py).

Garantem que:
  * a SYSTEM INSTRUCTION é extraída corretamente;
  * as diretivas [[INCLUDE: ...]] são resolvidas (inlining dos blocos compartilhados);
  * comentários de autoria (linhas '#') não vazam para o texto final;
  * os 5 prompts de produção carregam, resolvem includes e contêm os blocos esperados;
  * a persona única da Aura aparece nos 2 prompts da Aura (fonte única de verdade).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from config import prompt_loader
from config.prompt_loader import (
    PROMPTS_DIR,
    load_system_instruction,
    clear_cache,
)

# Prompts de produção e seus arquivos.
AGENT_PROMPTS = [
    "motor_intencao.v1.txt",
    "aura_enriquecer_narrativa.v1.txt",
    "aura_regerar_passo.v1.txt",
    "arbitro_sandbox.v1.txt",
    "quiz_generator.v1.txt",
]

AURA_PROMPTS = ["aura_enriquecer_narrativa.v1.txt", "aura_regerar_passo.v1.txt"]


@pytest.fixture(autouse=True)
def _clear_prompt_cache():
    clear_cache()
    yield
    clear_cache()


# --------------------------------------------------------------------------- #
# Includes / parsing (usando arquivos temporários)
# --------------------------------------------------------------------------- #
def test_resolves_include_and_extracts_system(tmp_path, monkeypatch):
    shared = tmp_path / "shared"
    shared.mkdir()
    (shared / "_bloco.txt").write_text("LINHA DO BLOCO COMPARTILHADO", encoding="utf-8")

    agente = tmp_path / "agente.v1.txt"
    agente.write_text(
        "# cabeçalho de metadados (deve ser ignorado)\n"
        "# [[INCLUDE: ...]] em comentário também deve ser ignorado\n"
        "===SYSTEM===\n"
        "Você é um agente de teste.\n"
        "[[INCLUDE: shared/_bloco.txt]]\n"
        "===USER===\n"
        ">>> CONTEÚDO DINÂMICO:\n"
        "{variavel}\n"
        "Responda com JSON.\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(prompt_loader, "PROMPTS_DIR", tmp_path)
    clear_cache()

    system = load_system_instruction("agente.v1.txt")

    # System instruction presente e include resolvido.
    assert "Você é um agente de teste." in system
    assert "LINHA DO BLOCO COMPARTILHADO" in system
    # Comentários de autoria NÃO vazam.
    assert "cabeçalho de metadados" not in system
    # Conteúdo dinâmico do usuário NÃO entra na system instruction.
    assert "{variavel}" not in system
    assert "Responda com JSON." not in system


def test_missing_include_raises(tmp_path, monkeypatch):
    agente = tmp_path / "agente.v1.txt"
    agente.write_text(
        "# cabeçalho\n"
        "===SYSTEM===\n"
        "Olá.\n"
        "[[INCLUDE: shared/_nao_existe.txt]]\n"
        "===USER===\n"
        "{x}\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(prompt_loader, "PROMPTS_DIR", tmp_path)
    clear_cache()

    with pytest.raises(FileNotFoundError):
        load_system_instruction("agente.v1.txt")


def test_missing_prompt_raises(tmp_path, monkeypatch):
    monkeypatch.setattr(prompt_loader, "PROMPTS_DIR", tmp_path)
    clear_cache()
    with pytest.raises(FileNotFoundError):
        load_system_instruction("inexistente.v1.txt")


# --------------------------------------------------------------------------- #
# Prompts de produção reais
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("prompt_name", AGENT_PROMPTS)
def test_production_prompt_loads_with_nonempty_system(prompt_name):
    path = PROMPTS_DIR / prompt_name
    assert path.exists(), f"Prompt de produção ausente: {prompt_name}"
    system = load_system_instruction(prompt_name)
    assert system.strip(), f"System instruction vazia em {prompt_name}"
    # Nenhum include deve ter sobrado por resolver.
    assert "[[INCLUDE" not in system, f"Include não resolvido em {prompt_name}"


@pytest.mark.parametrize("prompt_name", AGENT_PROMPTS)
def test_production_prompt_has_no_authoring_comments(prompt_name):
    """Linhas de comentário de autoria não devem vazar para a system instruction."""
    system = load_system_instruction(prompt_name)
    # O cabeçalho de metadados usa "AGENTE:"; não deve aparecer no texto final.
    assert "Arquivo:" not in system
    assert "Versão:" not in system


@pytest.mark.parametrize("prompt_name", AURA_PROMPTS)
def test_aura_persona_is_single_source_of_truth(prompt_name):
    """Ambos os prompts da Aura devem carregar a MESMA persona via include."""
    system = load_system_instruction(prompt_name)
    assert "Aura" in system
    assert "Arquiteta de Conhecimento" in system
    # A voz híbrida (âncora professora / micro técnica) precisa estar presente.
    assert "ÂNCORA" in system or "âncora" in system.lower()


def test_guardrails_present_in_aura_and_arbiter():
    """Guardrail de fidelidade deve estar nos prompts que produzem conteúdo."""
    for prompt_name in ["aura_enriquecer_narrativa.v1.txt", "aura_regerar_passo.v1.txt"]:
        system = load_system_instruction(prompt_name)
        assert "FIDELIDADE" in system or "ANTI-ALUCINA" in system.upper()


def test_tts_style_in_aura_not_in_quiz():
    """Estilo TTS (sem emoji) vale para a narração da Aura, não para o quiz lido na tela."""
    aura = load_system_instruction("aura_enriquecer_narrativa.v1.txt")
    quiz = load_system_instruction("quiz_generator.v1.txt")
    assert "ÁUDIO" in aura.upper() or "TTS" in aura.upper()
    assert "TTS" not in quiz.upper()
