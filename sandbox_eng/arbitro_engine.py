import json
import logging
from google import genai
from google.genai import types as genai_types
from config.settings import get_settings

logger = logging.getLogger(__name__)

async def avaliar_acao_sandbox(roteiro: list, passo_esperado: int, action_data: dict) -> dict:
    """
    Avalia se o clique atual corresponde ao esperado no roteiro.
    """
    if passo_esperado > len(roteiro):
        return {"is_correct": False, "hint": "Você já concluiu o tutorial!"}
        
    passo_atual_dados = roteiro[passo_esperado - 1]
    
    settings = get_settings()
    if not settings.google_api_key:
        return {"is_correct": True, "hint": "Sem API Key para avaliar"}
        
    prompt = f"""Você é um Árbitro de Sandbox (RPA Evaluation).
O usuário deve realizar o passo {passo_esperado} de um tutorial.
O passo correto original foi:
- Intenção: {passo_atual_dados.get('intencao_original')}
- Elemento esperado (Texto): {passo_atual_dados.get('_simlink', {}).get('target_text')}
- Seletor esperado: {passo_atual_dados.get('_simlink', {}).get('selector')}

O usuário acabou de realizar a seguinte ação:
- URL atual: {action_data.get('url')}
- Elemento Clicado: {action_data.get('target_tag')} com texto "{action_data.get('target_text')}"
- Seletor Clicado: {action_data.get('css_selector')}

A ação do usuário corresponde semanticamente ao esperado?
Responda APENAS em JSON com a estrutura:
{{
  "is_correct": boolean,
  "hint": "string (se is_correct for false, dê uma dica amigável, ex: 'Clique no botão X')"
}}
"""
    try:
        client = genai.Client(api_key=settings.google_api_key)
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0
            )
        )
        return json.loads(response.text)
    except Exception as e:
        logger.error(f"Erro no árbitro: {e}")
        return {"is_correct": False, "hint": "Erro ao validar ação."}
