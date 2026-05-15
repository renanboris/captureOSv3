"""
tests/unit/test_schemas.py

Verifica que os TypedDicts de schemas.py contêm todos os campos
esperados. Não testa lógica, mas serve como contrato vivo:
se alguém remover um campo crítico, esse teste falha.
"""
import pytest
from schemas import EventoCapturado, ResultadoExecucao, SoMBox, AXNode


class TestEventoCapturadoSchema:
    """Garante que EventoCapturado tem todos os campos necessários para captura e execução."""

    CAMPOS_OBRIGATORIOS = [
        "id_acao", "acao", "timestamp", "tag", "label", "seletor",
        "primeng_component", "iframe_hint", "modal_context", "posicao",
        "html_hint", "valor_input", "ax_node", "som_idx_clicado",
        "som_total_boxes", "screenshot_som_b64", "screenshot_raw_b64",
        "intencao_semantica", "contexto_tela", "tipo_elemento", "confianca",
        "page_title", "page_url", "url_destino", "url_origem",
    ]

    def test_campos_presentes_nos_annotations(self):
        """Todos os campos obrigatórios devem existir nas anotações de tipo."""
        anotacoes = EventoCapturado.__annotations__
        for campo in self.CAMPOS_OBRIGATORIOS:
            assert campo in anotacoes, (
                f"Campo '{campo}' ausente em EventoCapturado — "
                f"o schema pode ter sido alterado sem atualizar o executor."
            )

    def test_url_destino_e_url_origem_presentes(self):
        """url_destino e url_origem são críticos para a navegação SPA inteligente."""
        anotacoes = EventoCapturado.__annotations__
        assert "url_destino" in anotacoes
        assert "url_origem" in anotacoes


class TestResultadoExecucaoSchema:
    CAMPOS = ["id_acao", "status", "pre_condicao", "pos_condicao",
              "estrategia_usada", "tentativas", "detalhe_erro"]

    def test_campos_presentes(self):
        anotacoes = ResultadoExecucao.__annotations__
        for campo in self.CAMPOS:
            assert campo in anotacoes, f"Campo '{campo}' ausente em ResultadoExecucao"


class TestSoMBoxSchema:
    CAMPOS = ["idx", "x", "y", "w", "h", "role", "label"]

    def test_campos_presentes(self):
        anotacoes = SoMBox.__annotations__
        for campo in self.CAMPOS:
            assert campo in anotacoes, f"Campo '{campo}' ausente em SoMBox"


class TestAXNodeSchema:
    CAMPOS = ["ax_role", "ax_name", "ax_states"]

    def test_campos_presentes(self):
        anotacoes = AXNode.__annotations__
        for campo in self.CAMPOS:
            assert campo in anotacoes, f"Campo '{campo}' ausente em AXNode"
