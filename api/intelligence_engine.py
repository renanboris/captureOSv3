import base64
import json
import os
import logging
from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types

logger = logging.getLogger(__name__)

async def processar_intencao(image_bytes: bytes, event_data: dict, a11y_tree: list) -> dict:
    load_dotenv()
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        return {"intencao": "Configurar GOOGLE_API_KEY", "jargao": "Desconhecido"}
        
    client = genai.Client(api_key=api_key)
    
    prompt = f"""Você é o Motor de Inteligência do Capture OS v3.
O usuário executou uma ação do tipo '{event_data.get('action')}' no elemento da tela.
Abaixo está o log semântico extraído:
Alvo: {event_data.get('target_tag')} - Texto: {event_data.get('target_text')}

A imagem anexa já possui o Set-of-Marks desenhado.
Responda com o jargão corporativo exato de negócio para esta intenção.
Exemplo: "Clicar no botão Relatórios de Pagamento".
Responda apenas com JSON:
{{"intencao_detalhada": "sua frase corporativa aqui", "confidence": "high"}}"""

    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                genai_types.Part.from_text(text=prompt),
                genai_types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
            ],
            config=genai_types.GenerateContentConfig(response_mime_type="application/json")
        )
        return json.loads(response.text)
    except Exception as e:
        logger.error(f"Erro no Gemini Engine: {e}")
        return {"erro": str(e)}
