import base64
import json
import os
import logging
from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types
from api.status_manager import update_status
from api.rag_engine import buscar_contexto_multi_namespace

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

async def enriquecer_narrativa(roteiro_bruto: list, transcricao_instrutor: str = None) -> list:
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
    
    # Extrai o "Objetivo" com base nos primeiros passos gravados (RAG Reverso)
    resumo_passos = " ".join([p.get('intencao_original', '') for p in roteiro_bruto[:3]])
    logger.info(f"Deducindo objetivo para RAG a partir de: {resumo_passos}")
    
    rag_result = buscar_contexto_multi_namespace(resumo_passos)
    rag_prompt_section = ""
    if rag_result and rag_result.get("texto_rag"):
        logger.info(f"RAG Encontrado no namespace: {rag_result.get('namespace')} (Score: {rag_result.get('score'):.2f})")
        rag_prompt_section = f"""
BASE DE CONHECIMENTO CORPORATIVA (MANUAL DO SISTEMA):
-----------------------------------------------------
{rag_result.get('texto_rag')}
-----------------------------------------------------
RECOMENDAÇÃO: Se as intenções acima tiverem relação com este manual, UTILIZE O JARGÃO TÉCNICO, NOME DE TELAS e o contexto de negócio oficial da Senior descritos nele. Isso dará autoridade e precisão ao seu roteiro.
"""
    else:
        logger.info("Nenhum manual RAG compatível encontrado para os passos iniciais.")

    # Prepara o JSON para injetar no prompt
    roteiro_texto = json.dumps(roteiro_bruto, ensure_ascii=False, indent=2)
    
    transcricao_section = ""
    if transcricao_instrutor:
        transcricao_section = f"""
TRANSCRIÇÃO DA EXPLICAÇÃO DO INSTRUTOR (use como contexto para enriquecer o roteiro):
---------------------------------------------------------------------------------------
{transcricao_instrutor[:3000]}
---------------------------------------------------------------------------------------
O instrutor explicou o processo com suas próprias palavras acima. Use o raciocínio e
o contexto que ele trouxe para tornar o roteiro mais rico e preciso.
"""
    
    prompt = f"""Você é a Aura, Arquiteta de Conhecimento Sênior da Senior Sistemas.
Sua missão é ler uma lista de intenções isoladas extraídas de uma sessão de gravação 
e enriquecê-las para formar um roteiro em formato JSON com ótima pedagogia de ensino.

{rag_prompt_section}
{transcricao_section}

REGRAS DE OURO DA MONTAGEM (NUNCA VIOLE):
1. INTEGRIDADE DOS CLIQUES (CRÍTICO): Você DEVE retornar TODOS os passos do roteiro bruto. NUNCA pule, omita ou agrupe os passos num só. Se o usuário clicou em 'Nova Pasta', esse passo tem que existir no JSON de resposta.
2. A INTRODUÇÃO (PASSO 0): Crie um passo extra OBRIGATÓRIO no início (passo: 0, timestamp: 0) com uma "ancora" rica que faça a introdução do objetivo do vídeo com peso professoral (Peso 3). A "micro_narracao" deste passo deve ser vazia "".
3. A CONCLUSÃO: Crie um passo extra OBRIGATÓRIO no final (passo: 999, timestamp: 99999999) com "ancora" celebrativa e resumo do que foi aprendido. A "micro_narracao" deve ser vazia "".
4. PESO NARRATIVO: A âncora explica o POR QUÊ. A micro_narracao explica o COMO. Se o passo é óbvio, deixe a ancora vazia e narre só a micro_narracao.
5. ANTI-GERÚNDIO: Evite usar sempre "...clicando em X... abrindo Y". Use variações como "...aqui, o menu X...", "...e depois, selecionamos Y...". Fale de forma fluida.

ROTEIRO BRUTO (Intenções Técnicas capturadas):
{roteiro_texto}

Gere o JSON seguindo EXATAMENTE esta estrutura de Array:
[
  {{
    "passo": 0,
    "timestamp": 0,
    "intencao_original": "Introdução do Objetivo",
    "ancora": "Hoje vamos aprender a criar uma estrutura de pastas do zero...",
    "micro_narracao": ""
  }},
  {{
    "passo": 1,
    "timestamp": 123456789,
    "intencao_original": "Acionar Nova Pasta",
    "ancora": "Tudo começa criando o diretório raiz.",
    "micro_narracao": "Para isso, vamos no botão Nova Pasta."
  }},
  {{
    "passo": 999,
    "timestamp": 99999999,
    "intencao_original": "Conclusão",
    "ancora": "Pronto! Em poucos segundos nossa estrutura está pronta para a equipe.",
    "micro_narracao": ""
  }}
]

Responda APENAS com a lista JSON validada, preservando os mesmos timestamps (exceto para intro/conclusão).
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
