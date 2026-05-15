"""
tests/unit/test_som_annotator.py

Testa as três funções públicas do módulo som_annotator:
  - identificar_box_clicada  (pura, sem I/O)
  - anotar_imagem            (PIL, sem browser)
  - get_som_boxes            coberto nos testes de integração
"""
import io
import pytest
from PIL import Image
from som_annotator import identificar_box_clicada, anotar_imagem


# ---------------------------------------------------------------------------
# identificar_box_clicada
# ---------------------------------------------------------------------------

class TestIdentificarBoxClicada:

    def test_clique_dentro_da_unica_box(self, som_boxes_sample):
        """Clique no centro da box 'Salvar' (idx=1) deve retornar 1."""
        # Salvar: x=10, y=10, w=100, h=40 → centro (60, 30)
        result = identificar_box_clicada(som_boxes_sample, x=60, y=30)
        assert result == 1

    def test_clique_fora_de_todas_as_boxes(self, som_boxes_sample):
        """Clique em coordenada sem nenhuma box deve retornar None."""
        result = identificar_box_clicada(som_boxes_sample, x=500, y=500)
        assert result is None

    def test_clique_na_borda_da_box(self, som_boxes_sample):
        """Clique exatamente no canto superior esquerdo da box 'Cancelar' (idx=2)."""
        # Cancelar: x=120, y=10
        result = identificar_box_clicada(som_boxes_sample, x=120, y=10)
        assert result == 2

    def test_overlap_retorna_menor_area(self, som_boxes_sample):
        """
        Boxes 3 e 4 se sobrepõem na região x=[20,70], y=[65,80].
        O clique nessa região deve retornar idx=4 (a box menor/mais específica).
        """
        # Box 4: x=20, y=65, w=50, h=15 → área 750
        # Box 3: x=10, y=60, w=200, h=30 → área 6000
        result = identificar_box_clicada(som_boxes_sample, x=45, y=72)
        assert result == 4, "Em overlap, deve retornar a box de menor área (mais específica)"

    def test_lista_vazia_retorna_none(self):
        """Nenhuma box → sempre None."""
        result = identificar_box_clicada([], x=10, y=10)
        assert result is None


# ---------------------------------------------------------------------------
# anotar_imagem
# ---------------------------------------------------------------------------

class TestAnotarImagem:

    def test_retorna_bytes_validos(self, screenshot_blank, som_boxes_sample):
        """anotar_imagem deve retornar bytes não-vazios de uma imagem JPEG válida."""
        result = anotar_imagem(screenshot_blank, som_boxes_sample)
        assert isinstance(result, bytes)
        assert len(result) > 0
        # Verificar que o resultado é um JPEG válido
        img = Image.open(io.BytesIO(result))
        assert img.format == "JPEG"

    def test_dimensoes_preservadas(self, screenshot_blank, som_boxes_sample):
        """A imagem anotada deve ter as mesmas dimensões da original."""
        result = anotar_imagem(screenshot_blank, som_boxes_sample)
        img_orig = Image.open(io.BytesIO(screenshot_blank))
        img_result = Image.open(io.BytesIO(result))
        assert img_orig.size == img_result.size

    def test_lista_vazia_retorna_imagem(self, screenshot_blank):
        """Com zero boxes, deve retornar a imagem sem erros (sem anotações)."""
        result = anotar_imagem(screenshot_blank, [])
        assert isinstance(result, bytes)
        img = Image.open(io.BytesIO(result))
        assert img.format == "JPEG"

    def test_failsafe_em_bytes_invalidos(self):
        """Se os bytes forem inválidos, deve retornar os mesmos bytes sem exceção."""
        bad_bytes = b"not-a-jpeg"
        result = anotar_imagem(bad_bytes, [])
        assert result == bad_bytes

    def test_badge_visivel_na_imagem(self, screenshot_blank):
        """
        Verifica que a imagem anotada difere da original
        (pelo menos 1 pixel foi alterado pelos badges).
        """
        boxes = [{"idx": 1, "x": 5, "y": 5, "w": 30, "h": 20, "role": "button", "label": "OK"}]
        result = anotar_imagem(screenshot_blank, boxes)
        orig_img = Image.open(io.BytesIO(screenshot_blank)).convert("RGB")
        ann_img = Image.open(io.BytesIO(result)).convert("RGB")
        # Verifica que pelo menos um pixel na região do badge foi alterado
        orig_px = orig_img.getpixel((6, 6))
        ann_px = ann_img.getpixel((6, 6))
        assert orig_px != ann_px, "Badge vermelho deve ter alterado pelo menos 1 pixel"
