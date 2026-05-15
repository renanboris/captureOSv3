"""
conftest.py — Fixtures compartilhadas entre todos os testes.

- `som_boxes_sample`: lista de SoMBox de referência para testes unitários.
- `screenshot_blank`: imagem JPEG 200x100 totalmente cinza para testes de anotação.
- `browser` / `page`: browser Playwright headless para testes de integração.
"""
import io
import sys
import os
import pytest
import pytest_asyncio
from PIL import Image
from playwright.async_api import async_playwright

# Garante que o diretório pai (poc/) está no sys.path para imports
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# ---------------------------------------------------------------------------
# Fixtures unitárias
# ---------------------------------------------------------------------------

@pytest.fixture
def som_boxes_sample():
    """Lista estável de SoMBoxes para testes de hit-test e sobreposição."""
    return [
        {"idx": 1, "x": 10,  "y": 10,  "w": 100, "h": 40,  "role": "button", "label": "Salvar"},
        {"idx": 2, "x": 120, "y": 10,  "w": 80,  "h": 40,  "role": "button", "label": "Cancelar"},
        {"idx": 3, "x": 10,  "y": 60,  "w": 200, "h": 30,  "role": "input",  "label": "Nome"},
        # box menor dentro da box 3 (overlap — deve retornar a menor)
        {"idx": 4, "x": 20,  "y": 65,  "w": 50,  "h": 15,  "role": "input",  "label": "Nome inner"},
    ]

@pytest.fixture
def screenshot_blank():
    """Imagem JPEG 200x100 cinza em bytes — usada como screenshot de referência."""
    img = Image.new("RGB", (200, 100), color=(128, 128, 128))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()

# ---------------------------------------------------------------------------
# Fixtures de integração (Playwright headless)
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def page():
    """Cria uma página Playwright headless por teste e fecha ao final."""
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 800})
        pg = await ctx.new_page()
        yield pg
        await ctx.close()
        await browser.close()
