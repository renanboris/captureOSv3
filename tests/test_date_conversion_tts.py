import pytest
from video_eng.tts_generator import converter_datas_por_extenso

def test_converter_datas_por_extenso():
    assert converter_datas_por_extenso("Reunião no dia 24/07/2026 às 14h") == "Reunião no dia 24 de julho de 2026 às 14h"
    assert converter_datas_por_extenso("Validade: 01/01/2025") == "Validade: 1 de janeiro de 2025"
    assert converter_datas_por_extenso("Agendado para 15/09") == "Agendado para 15 de setembro"
    assert converter_datas_por_extenso("Sem data aqui") == "Sem data aqui"
