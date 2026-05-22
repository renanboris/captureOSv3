import base64
import json
import os
import logging
from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types
from api.status_manager import update_status

logger = logging.getLogger(__name__)

async def processar_intencao(image_bytes: bytes, event_data: dict, a11y_tree: list, session_id: str = None) -> dict:
    load_dotenv()
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        return {"intencao": "Configurar GOOGLE_API_KEY", "jargao": "Desconhecido"}
    
    if session_id:
        update_status(session_id, "processing", "Analisando intenção do usuário com IA...")
        
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

async def enriquecer_narrativa(roteiro_bruto: list) -> list:
    """
    Passo 2 (Enriquecimento Semântico): 
    Olha o cenário completo de cliques e gera a âncora (Big Picture) e a micro narração (Instrução exata).
    """
    load_dotenv()
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        logger.error("Sem API KEY para enriquecimento")
        return roteiro_bruto
        
    client = genai.Client(api_key=api_key)
    
    # Prepara o JSON para injetar no prompt
    roteiro_texto = json.dumps(roteiro_bruto, ensure_ascii=False, indent=2)
    
    prompt = f"""Você é a Aura, uma Arquiteta de Treinamentos de Software.
Sua missão é ler uma lista de intenções isoladas extraídas de uma sessão de gravação 
e enriquecê-las para formar um roteiro em formato JSON com ótima pedagogia de ensino.

REGRAS DE OURO DA MONTAGEM:
1. PEDAGOGIA: O Passo 1 DEVE sempre ter uma "ancora" explicativa e rica. 
   A "ancora" ensina o POR QUÊ do cenário. A "micro_narracao" ensina o COMO.
2. ECONOMIA: NUNCA repita a mesma informação na "ancora" e na "micro_narracao". 
   Deixe a "ancora" vazia se a ação for muito óbvia ou continuação imediata.
3. ESTILO: Transforme jargões robóticos em uma narração fluida e amigável para o usuário final.

ROTEIRO BRUTO (Jargões Técnicos):
{roteiro_texto}

Gere o JSON seguindo EXATAMENTE esta estrutura:
[
  {{
    "passo": 1,
    "timestamp": 123456789,
    "intencao_original": "Clicou em Relatório",
    "ancora": "Vamos aprender a extrair a listagem de clientes.",
    "micro_narracao": "Para começar, clique no menu de Relatórios."
  }},
  {{
    "passo": 2,
    "timestamp": 123456799,
    "intencao_original": "Clicou em PDF",
    "ancora": "",
    "micro_narracao": "Em seguida, selecione o formato PDF e pronto."
  }}
]

Responda APENAS com a lista JSON validada, preservando os mesmos timestamps recebidos.
"""

    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.3
            )
        )
        roteiro_enriquecido = json.loads(response.text)
        return roteiro_enriquecido
    except Exception as e:
        logger.error(f"Erro no Enriquecimento Semântico: {e}")
        # Retorna o bruto se falhar para não quebrar a compilação do vídeo
        return roteiro_bruto
