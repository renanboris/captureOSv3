import json, logging
from google import genai
from google.genai import types as genai_types
from config.prompt_loader import load_system_instruction
from config.genai_client import get_genai_client

logger = logging.getLogger("uvicorn.error")

PROMPT_QUIZ = "quiz_generator.v1.txt"


async def gerar_quiz(roteiro: list, api_key: str = "", num_questoes: int = 3) -> list:
    """
    Gera quiz de múltipla escolha a partir do roteiro aprovado.
    """
    try:
        client = get_genai_client()
    except RuntimeError:
        return []

    texto_roteiro = "\n".join([
        f"Passo {p['passo']}: {p.get('ancora','')} {p.get('micro_narracao','')}".strip()
        for p in roteiro
        if p.get('passo', 0) not in (0, 999)
    ])

    system_instruction = load_system_instruction(PROMPT_QUIZ)

    user_content = f"""Crie exatamente {num_questoes} questões de múltipla escolha (4 opções cada) com base no tutorial abaixo.

<TUTORIAL>
{texto_roteiro}
</TUTORIAL>"""

    try:
        logger.info("Quiz: chamando Gemini API...")
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=user_content,
            config=genai_types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                temperature=0.4
            )
        )
        logger.info("Quiz: resposta recebida da API.")
        return json.loads(response.text)
    except Exception as e:
        logger.error(f"Erro ao gerar quiz: {e}")
        return []
