import json
import logging
from google import genai
from google.genai import types as genai_types
from config.settings import get_settings
from config.prompt_loader import load_system_instruction
from config.genai_client import get_genai_client

logger = logging.getLogger(__name__)

PROMPT_ARBITRO = "arbitro_sandbox.v1.txt"


async def avaliar_acao_sandbox(roteiro: list, passo_esperado: int, action_data: dict) -> dict:
    """
    Avalia se o clique atual corresponde ao esperado no roteiro.
    """
    if passo_esperado > len(roteiro):
        return {"is_correct": False, "hint": "Você já concluiu o tutorial!"}

    passo_atual_dados = roteiro[passo_esperado - 1]

    settings = get_settings()

    try:
        client = get_genai_client()
    except RuntimeError:
        return {"is_correct": True, "hint": "Sem credenciais Google AI para avaliar"}

    simlink_data = passo_atual_dados.get('_simlink', {})
    expected_text = simlink_data.get('target_text', '')
    expected_selector = simlink_data.get('selector', '')
    expected_xpath = simlink_data.get('xpath', '')

    actual_text = action_data.get('target_text', '')
    actual_selector = action_data.get('css_selector', '')
    actual_xpath = action_data.get('xpath', '')

    # Validação Primária (Rápida)
    match_text = expected_text and actual_text and (expected_text.lower() in actual_text.lower() or actual_text.lower() in expected_text.lower())
    match_selector = expected_selector and actual_selector and expected_selector == actual_selector
    match_xpath = expected_xpath and actual_xpath and expected_xpath == actual_xpath

    if match_selector or match_xpath or (match_text and len(expected_text) > 3):
        return {"is_correct": True, "hint": ""}

    system_instruction = load_system_instruction(PROMPT_ARBITRO)

    user_content = f"""<PASSO_ESPERADO numero="{passo_esperado}">
Intenção: {passo_atual_dados.get('intencao_original')}
Elemento esperado (texto): {passo_atual_dados.get('_simlink', {}).get('target_text')}
Seletor esperado: {passo_atual_dados.get('_simlink', {}).get('selector')}
</PASSO_ESPERADO>

<ACAO_DO_ALUNO>
URL atual: {action_data.get('url')}
Elemento clicado: {action_data.get('target_tag')} com texto "{action_data.get('target_text')}"
Seletor clicado: {action_data.get('css_selector')}
</ACAO_DO_ALUNO>"""

    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=user_content,
            config=genai_types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                temperature=0.0
            )
        )
        return json.loads(response.text)
    except Exception as e:
        logger.error(f"Erro no árbitro: {e}")
        # Falha de IA não deve reprovar o aluno: mantém neutro e permite nova tentativa.
        return {"is_correct": False, "hint": "Não consegui validar agora. Tente novamente."}
