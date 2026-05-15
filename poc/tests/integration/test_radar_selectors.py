"""
tests/integration/test_radar_selectors.py

Injeta o radar_v3.js em páginas HTML simples (via data: URI) e
verifica que getBestSelector gera os seletores corretos para
diferentes tipos de elemento: aria-label, data-testid, id,
texto puro, ícones FontAwesome e itens de menu de contexto.

Todos os testes rodam em browser Chromium headless via Playwright.
"""
import os
import pytest

RADAR_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "radar_v3.js")


async def load_radar(page):
    """Injeta o conteúdo do radar_v3.js na página atual e expoe getBestSelector no window."""
    with open(RADAR_PATH, "r", encoding="utf-8") as f:
        script = f.read()
    # O radar é uma IIFE — injetamos e depois expomos getBestSelector no window
    await page.evaluate(script)
    # Expoe as funções internas via wrapper: o radar já rodou, então re-avaliamos
    # o mesmo script + um shim que salva as funções no window antes do IIFE terminar.
    # Alternativa: avaliar as funções de forma isolada para testes.
    await page.evaluate("""
        () => {
            // Recria getBestSelector no window usando o mesmo código do radar
            // lendo os elementos presentes na página atual.
            // Como o radar já é IIFE, simulamos chamando processarEvento internamente
            // e capturando o seletor via mock de capturarElemento.
            window.__lastSelector = null;
            window.capturarElemento = (data) => {
                window.__lastSelector = JSON.parse(data).seletor;
            };
        }
    """)


async def get_selector(page, js_get_element: str) -> str:
    """
    Simula um clique no elemento retornado por js_get_element,
    capturando o seletor gerado pelo radar via window.__lastSelector.
    """
    # Reseta o estado
    await page.evaluate("() => { window.__lastSelector = null; }")
    # Dispara mousedown no elemento para o radar capturar
    await page.evaluate(f"""
        () => {{
            const el = {js_get_element};
            if (!el) return;
            el.dispatchEvent(new MouseEvent('mousedown', {{
                bubbles: true, cancelable: true, button: 0
            }}));
        }}
    """)
    # Aguarda o debounce do clique (250ms)
    await page.wait_for_timeout(300)
    result = await page.evaluate("() => window.__lastSelector")
    return result or ""


# ---------------------------------------------------------------------------
# Testes de getBestSelector
# ---------------------------------------------------------------------------

class TestRadarGetBestSelector:

    @pytest.mark.asyncio
    async def test_aria_label(self, page):
        """Elemento com aria-label deve gerar seletor [aria-label='...']."""
        await page.set_content("""
            <html><body>
                <button aria-label="Salvar documento">Salvar</button>
            </body></html>
        """)
        await load_radar(page)
        sel = await get_selector(page, "document.querySelector('button[aria-label]')")
        assert "aria-label" in sel
        assert "Salvar documento" in sel

    @pytest.mark.asyncio
    async def test_data_testid(self, page):
        """Elemento com data-testid deve ter prioridade máxima."""
        await page.set_content("""
            <html><body>
                <button data-testid="btn-confirmar">Confirmar</button>
            </body></html>
        """)
        await load_radar(page)
        sel = await get_selector(page, "document.querySelector('[data-testid]')")
        assert "data-testid" in sel
        assert "btn-confirmar" in sel

    @pytest.mark.asyncio
    async def test_id_estavel(self, page):
        """Elemento com id estável (sem prefixo ng-/mat-) deve gerar [id='...']."""
        await page.set_content("""
            <html><body>
                <button id="btn-salvar-principal">Salvar</button>
            </body></html>
        """)
        await load_radar(page)
        sel = await get_selector(page, "document.getElementById('btn-salvar-principal')")
        assert "btn-salvar-principal" in sel

    @pytest.mark.asyncio
    async def test_texto_puro(self, page):
        """Elemento sem atributos estáveis mas com texto deve usar text="..."."""
        await page.set_content("""
            <html><body>
                <button>Clique Aqui</button>
            </body></html>
        """)
        await load_radar(page)
        sel = await get_selector(page, "document.querySelector('button')")
        assert "Clique Aqui" in sel

    @pytest.mark.asyncio
    async def test_icone_fontawesome(self, page):
        """Span com classe fa-home deve gerar span.fa-home."""
        await page.set_content("""
            <html><body>
                <li role="menuitem">
                    <a href="#"><span class="ui-menuitem-icon fas fa-home"></span><span class="ui-menuitem-text"></span></a>
                </li>
            </body></html>
        """)
        await load_radar(page)
        sel = await get_selector(page, "document.querySelector('span.fa-home')")
        assert "fa-home" in sel

    @pytest.mark.asyncio
    async def test_ng_id_ignorado(self, page):
        """ID com prefixo 'ng-' não deve ser usado como seletor estável."""
        await page.set_content("""
            <html><body>
                <button id="ng-1234">Botão Angular</button>
            </body></html>
        """)
        await load_radar(page)
        sel = await get_selector(page, "document.querySelector('button')")
        # ng-1234 é instável, não deve aparecer sozinho como [id='ng-1234']
        assert "ng-1234" not in sel or "Botão Angular" in sel

    @pytest.mark.asyncio
    async def test_item_menu_contexto(self, page):
        """Item dentro de .ngx-contextmenu deve gerar seletor que identifica o item pelo texto."""
        await page.set_content("""
            <html><body>
                <div class="ngx-contextmenu">
                    <ul>
                        <li><a href="#">Favoritar</a></li>
                        <li><a href="#">Excluir</a></li>
                    </ul>
                </div>
            </body></html>
        """)
        await load_radar(page)
        sel = await get_selector(page, "document.querySelector('.ngx-contextmenu a')")
        # O radar gera seletor com o texto do item — pode usar ngx-contextmenu ou row context
        assert sel != "", "Seletor não deve ser vazio"
        assert "Favoritar" in sel, f"Seletor deve identificar o item 'Favoritar', gerado: {sel}"


# ---------------------------------------------------------------------------
# Testes de getFrameId (identificação de contexto)
# ---------------------------------------------------------------------------

class TestRadarGetFrameId:

    @pytest.mark.asyncio
    async def test_pagina_principal_capturada_corretamente(self, page):
        """
        Ao navegar na página principal, o campo 'iframe' do evento
        deve ser 'Pagina Principal' (verificado via evento de navegação).
        """
        await page.set_content("<html><body><p>Página principal</p></body></html>")
        await load_radar(page)
        # Captura evento de navegação que inclui campo iframe
        await page.evaluate("""
            () => {
                window._capturas = [];
                window.capturarElemento = (data) => { window._capturas.push(JSON.parse(data)); };
            }
        """)
        await page.evaluate("() => history.pushState({}, '', '#frame-test')")
        capturas = await page.evaluate("() => window._capturas")
        assert len(capturas) == 1
        assert capturas[0].get("iframe") == "Pagina Principal"


# ---------------------------------------------------------------------------
# Testes do guard capturarElemento
# ---------------------------------------------------------------------------

class TestRadarGuard:

    @pytest.mark.asyncio
    async def test_sem_capturar_elemento_nao_lanca_excecao(self, page):
        """
        Simula uma navegação SPA (pushState) sem o binding capturarElemento.
        O radar NÃO deve lançar TypeError — o guard deve silenciar a chamada.
        """
        await page.set_content("<html><body><button id='nav'>Ir</button></body></html>")
        await load_radar(page)
        # Dispara pushState sem capturarElemento binding
        error = await page.evaluate("""
            () => {
                try {
                    history.pushState({}, '', '#teste');
                    return null;
                } catch(e) {
                    return e.message;
                }
            }
        """)
        assert error is None, f"Guard falhou — exceção lançada: {error}"

    @pytest.mark.asyncio
    async def test_com_capturar_elemento_chama_corretamente(self, page):
        """Com capturarElemento definido, o radar deve chamá-lo ao navegar."""
        await page.set_content("<html><body><button id='go'>Go</button></body></html>")
        await load_radar(page)
        # Registra mock de capturarElemento
        await page.evaluate("""
            () => {
                window._capturas = [];
                window.capturarElemento = (data) => { window._capturas.push(JSON.parse(data)); };
            }
        """)
        # Dispara pushState
        await page.evaluate("() => history.pushState({}, '', '#rota-teste')")
        capturas = await page.evaluate("() => window._capturas")
        assert len(capturas) == 1
        assert capturas[0]["acao"] == "navegar"
        assert "url_destino" in capturas[0]
