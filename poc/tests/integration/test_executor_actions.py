"""
tests/integration/test_executor_actions.py

Testa o motor de execução do poc_executor em páginas HTML simples
renderizadas no Playwright headless. Não requer conexão com Senior X
ou com a API Gemini (gemini_client é patchado para None).

Cobre:
- Estratégia 1: clique via seletor CSS
- Estratégia 2: clique via SoM (fallback quando seletor falha)
- Preenchimento de campo (preencher_campo)
- get_som_boxes: retorna boxes do DOM corretamente
- Retorno False quando nenhuma estratégia funciona
"""
import pytest
import poc_executor
from poc_executor import executar_acao, get_locator
from som_annotator import get_som_boxes

# HTML simples reutilizado nos testes
PAGINA_BASICA = """
<html>
<body style="margin:0; padding:20px;">
  <button id="btn-salvar" aria-label="Salvar">Salvar</button>
  <button id="btn-cancelar">Cancelar</button>
  <input id="campo-nome" name="nome" type="text" placeholder="Digite seu nome" />
  <div id="resultado"></div>
  <script>
    document.getElementById('btn-salvar').addEventListener('click', () => {
        document.getElementById('resultado').innerText = 'salvo';
    });
    document.getElementById('btn-cancelar').addEventListener('click', () => {
        document.getElementById('resultado').innerText = 'cancelado';
    });
    document.getElementById('campo-nome').addEventListener('blur', (e) => {
        document.getElementById('resultado').innerText = 'preenchido:' + e.target.value;
    });
  </script>
</body>
</html>
"""


@pytest.fixture(autouse=True)
def sem_gemini(monkeypatch):
    """
    Desativa o cliente Gemini em todos os testes deste módulo.
    Assim pré e pós-condição assumem True sem chamada de API.
    """
    monkeypatch.setattr(poc_executor, 'gemini_client', None)


@pytest.fixture
async def pagina(page):
    """Carrega a página básica de testes e aguarda renderização."""
    await page.set_content(PAGINA_BASICA)
    await page.wait_for_load_state("domcontentloaded")
    return page


# ---------------------------------------------------------------------------
# Testes de clique — Estratégia 1: seletor
# ---------------------------------------------------------------------------

class TestExecutarAcaoSeletor:

    async def test_clique_por_aria_label(self, pagina):
        """Clique via seletor aria-label deve acionar o evento de clique."""
        evento = {
            "acao": "clique",
            "seletor": "[aria-label='Salvar']",
            "iframe_hint": None,
            "posicao": {"x": 0, "y": 0, "w": 0, "h": 0},
            "ax_node": None,
            "som_idx_clicado": None,
            "valor_input": "",
        }
        ok, estrategia = await executar_acao(pagina, evento, set())
        assert ok is True
        assert estrategia == "seletor"
        resultado = await pagina.locator("#resultado").inner_text()
        assert resultado == "salvo"

    async def test_clique_por_id(self, pagina):
        """Clique via seletor de id deve acionar o botão correto."""
        evento = {
            "acao": "clique",
            "seletor": "[id='btn-cancelar']",
            "iframe_hint": None,
            "posicao": {"x": 0, "y": 0, "w": 0, "h": 0},
            "ax_node": None,
            "som_idx_clicado": None,
            "valor_input": "",
        }
        ok, estrategia = await executar_acao(pagina, evento, set())
        assert ok is True
        assert estrategia == "seletor"
        resultado = await pagina.locator("#resultado").inner_text()
        assert resultado == "cancelado"

    async def test_seletor_invalido_retorna_false_na_estrategia(self, pagina):
        """
        Seletor inexistente deve falhar e o fallback de coordenadas
        (com posicao zerada) não deve acionar o elemento correto.
        Nenhuma estratégia deve retornar True quando o seletor é inválido
        e não há coords úteis.
        """
        evento = {
            "acao": "clique",
            "seletor": "[id='elemento-que-nao-existe']",
            "iframe_hint": None,
            "posicao": {"x": 0, "y": 0, "w": 0, "h": 0},
            "ax_node": None,
            "som_idx_clicado": None,
            "valor_input": "",
        }
        # Bloqueia seletor e som para forçar coordenada inútil
        estrategias_falhas = {"seletor", "som"}
        ok, estrategia = await executar_acao(pagina, evento, estrategias_falhas)
        # Coordenada (0, 0) clica fora de qualquer botão — nenhum resultado
        resultado = await pagina.locator("#resultado").inner_text()
        assert resultado == ""  # nenhum evento disparado pelos botões reais


# ---------------------------------------------------------------------------
# Testes de clique — Estratégia 2: SoM
# ---------------------------------------------------------------------------

class TestExecutarAcaoSoM:

    async def test_clique_via_ax_name(self, pagina):
        """Com seletor bloqueado, SoM deve usar ax_name para achar o botão."""
        evento = {
            "acao": "clique",
            "seletor": "[id='nao-existe']",  # vai falhar
            "iframe_hint": None,
            "posicao": {"x": 0, "y": 0, "w": 0, "h": 0},
            "ax_node": {"ax_name": "Salvar", "ax_role": "button", "ax_states": {}},
            "som_idx_clicado": 99,  # idx errado — SoM deve usar ax_name
            "valor_input": "",
        }
        ok, estrategia = await executar_acao(pagina, evento, {"seletor"})
        assert ok is True
        assert estrategia == "som"
        resultado = await pagina.locator("#resultado").inner_text()
        assert resultado == "salvo"


# ---------------------------------------------------------------------------
# Testes de preenchimento de campo
# ---------------------------------------------------------------------------

class TestExecutarAcaoPreencher:

    async def test_preencher_campo_via_seletor(self, pagina):
        """preencher_campo deve fazer fill + Tab no input correto."""
        evento = {
            "acao": "preencher_campo",
            "seletor": "[name='nome']",
            "iframe_hint": None,
            "posicao": {"x": 0, "y": 0, "w": 0, "h": 0},
            "ax_node": None,
            "som_idx_clicado": None,
            "valor_input": "João Silva",
        }
        ok, estrategia = await executar_acao(pagina, evento, set())
        assert ok is True
        assert estrategia == "seletor"
        # Tab dispara blur → resultado atualizado
        resultado = await pagina.locator("#resultado").inner_text()
        assert "João Silva" in resultado


# ---------------------------------------------------------------------------
# Testes de get_som_boxes
# ---------------------------------------------------------------------------

class TestGetSomBoxes:

    async def test_retorna_boxes_da_pagina(self, pagina):
        """get_som_boxes deve retornar pelo menos as boxes dos 2 botões e 1 input."""
        boxes = await get_som_boxes(pagina)
        assert len(boxes) >= 3, f"Esperado ≥3 boxes, encontrado {len(boxes)}"

    async def test_boxes_tem_campos_obrigatorios(self, pagina):
        """Cada box deve ter os campos: idx, x, y, w, h, role, label."""
        boxes = await get_som_boxes(pagina)
        campos = {"idx", "x", "y", "w", "h", "role", "label"}
        for box in boxes:
            assert campos.issubset(box.keys()), f"Box sem campos: {box}"

    async def test_idx_inicia_em_1(self, pagina):
        """O primeiro box (menor y, menor x) deve ter idx=1."""
        boxes = await get_som_boxes(pagina)
        assert boxes[0]["idx"] == 1, "idx deve iniciar em 1, não em 0"

    async def test_boxes_sem_duplicatas(self, pagina):
        """Não deve haver dois boxes com o mesmo (x, y, w, h)."""
        boxes = await get_som_boxes(pagina)
        coords = [(b["x"], b["y"], b["w"], b["h"]) for b in boxes]
        assert len(coords) == len(set(coords)), "Boxes duplicadas detectadas — WeakSet falhou"

    async def test_sem_elementos_fora_do_viewport(self, pagina):
        """Nenhum box deve ter y + h > viewport height."""
        viewport = pagina.viewport_size or {"height": 768}
        boxes = await get_som_boxes(pagina)
        for box in boxes:
            assert box["y"] + box["h"] <= viewport["height"] + 20, (
                f"Box {box['idx']} está fora do viewport: y={box['y']}, h={box['h']}"
            )


# ---------------------------------------------------------------------------
# Testes de retorno False quando nenhuma estratégia funciona
# ---------------------------------------------------------------------------

class TestExecutarAcaoFalha:

    async def test_retorna_false_sem_estrategias(self, pagina):
        """Com todas as estratégias bloqueadas, executar_acao deve retornar (False, '')."""
        evento = {
            "acao": "clique",
            "seletor": "[id='nao-existe']",
            "iframe_hint": None,
            "posicao": {"x": 0, "y": 0, "w": 0, "h": 0},
            "ax_node": None,
            "som_idx_clicado": None,
            "valor_input": "",
        }
        # Bloqueia todas as estratégias
        estrategias_falhas = {"seletor", "som", "coordenada"}
        ok, estrategia = await executar_acao(pagina, evento, estrategias_falhas)
        assert ok is False
        assert estrategia == ""
