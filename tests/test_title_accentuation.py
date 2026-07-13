import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from api.intelligence_engine import gerar_titulo_inteligente

@pytest.mark.anyio
async def test_gerar_titulo_inteligente_preserves_accentuation():
    # Mock do cliente Gemini
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.text = "  Configuração de Usuário - Novo Tutorial!  "
    mock_response.usage_metadata = None
    
    # generate_content é assíncrono, então usamos AsyncMock
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)

    roteiro_mock = [{"intencao_original": "Clique no botão de salvar"}]

    with patch("api.intelligence_engine.get_genai_client", return_value=mock_client):
        titulo = await gerar_titulo_inteligente(roteiro_mock, namespace="auto")
        
        # O título deve manter "Configuração", "Usuário", hifens e espaços, mas remover "!"
        assert titulo == "Configuração de Usuário - Novo Tutorial"
