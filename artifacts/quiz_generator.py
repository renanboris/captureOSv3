import json, logging
from google import genai
from google.genai import types as genai_types

logger = logging.getLogger(__name__)

async def gerar_quiz(roteiro: list, api_key: str, num_questoes: int = 3) -> list:
    """
    Gera quiz de múltipla escolha a partir do roteiro aprovado.
    """
    if not api_key:
        return []

    texto_roteiro = "\n".join([
        f"Passo {p['passo']}: {p.get('ancora','')} {p.get('micro_narracao','')}".strip()
        for p in roteiro
        if p.get('passo', 0) not in (0, 999)
    ])

    prompt = f"""Você é um especialista em avaliação de treinamentos corporativos.
Com base no tutorial abaixo, crie exatamente {num_questoes} questões de múltipla escolha.
Cada questão deve testar se o aluno compreendeu o processo — não decoreba de cliques.
Foque no "por quê" e na sequência lógica das ações.

TUTORIAL:
{texto_roteiro}

Responda APENAS com JSON válido, sem markdown, sem explicações externas, com o seguinte formato:
[
  {{
    "pergunta": "Texto da pergunta",
    "opcoes": ["Opção A", "Opção B", "Opção C", "Opção D"],
    "correta": 0,
    "explicacao": "Por que esta opção está correta"
  }}
]
"""
    try:
        client = genai.Client(api_key=api_key)
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.4
            )
        )
        return json.loads(response.text)
    except Exception as e:
        logger.error(f"Erro ao gerar quiz: {e}")
        return []
