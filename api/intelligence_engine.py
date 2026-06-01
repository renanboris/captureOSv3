import base64
import json
import os
import logging
from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types
from openai import AsyncOpenAI
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
        roteiro_enriquecido_ai = json.loads(response.text)
        
        # Fazer o merge da resposta da IA de volta no roteiro_bruto para preservar a propriedade _simlink (hotspots de tela)
        for ai_passo in roteiro_enriquecido_ai:
            for bruto_passo in roteiro_bruto:
                if str(ai_passo.get("passo")) == str(bruto_passo.get("passo")):
                    bruto_passo["ancora"] = ai_passo.get("ancora", "")
                    bruto_passo["micro_narracao"] = ai_passo.get("micro_narracao", "")
                    if ai_passo.get("intencao_original"):
                        bruto_passo["intencao_original"] = ai_passo.get("intencao_original")
                    break
                    
        return roteiro_bruto
    except Exception as e:
        logger.error(f"Erro no Enriquecimento Semântico (Gemini): {e}. Tentando OpenAI Fallback...")
        openai_key = os.getenv("OPENAI_API_KEY", "")
        if openai_key:
            try:
                openai_client = AsyncOpenAI(api_key=openai_key)
                completion = await openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "Você é a Aura. Retorne EXATAMENTE o JSON puro do array, sem usar blocos de markdown ```json."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.3
                )
                res_text = completion.choices[0].message.content.strip()
                if res_text.startswith("```json"):
                    res_text = res_text[7:-3].strip()
                elif res_text.startswith("```"):
                    res_text = res_text[3:-3].strip()
                    
                roteiro_enriquecido_ai = json.loads(res_text)
                
                for ai_passo in roteiro_enriquecido_ai:
                    for bruto_passo in roteiro_bruto:
                        if str(ai_passo.get("passo")) == str(bruto_passo.get("passo")):
                            bruto_passo["ancora"] = ai_passo.get("ancora", "")
                            bruto_passo["micro_narracao"] = ai_passo.get("micro_narracao", "")
                            if ai_passo.get("intencao_original"):
                                bruto_passo["intencao_original"] = ai_passo.get("intencao_original")
                            break
                return roteiro_bruto
            except Exception as e2:
                logger.error(f"Erro no Fallback OpenAI (Enriquecimento): {e2}")

        # Retorna o bruto preenchido com textos básicos se tudo falhar
        for passo in roteiro_bruto:
            passo["ancora"] = passo.get("intencao_original", "Interação na tela")
            passo["micro_narracao"] = ""
        return roteiro_bruto

async def regerar_passo_isolado(passo_alvo: dict, passo_anterior: dict = None, passo_seguinte: dict = None) -> dict:
    """
    Regera a âncora e a micro narração de um passo específico,
    levando em consideração o contexto dos passos adjacentes.
    """
    load_dotenv()
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        return passo_alvo

    client = genai.Client(api_key=api_key)

    contexto = ""
    if passo_anterior:
        contexto += f"Passo Anterior:\n- Intenção: {passo_anterior.get('intencao_original')}\n- Âncora: {passo_anterior.get('ancora')}\n- Micro: {passo_anterior.get('micro_narracao')}\n\n"
    
    contexto += f"PASSO A SER REGERADO:\n- Intenção Original: {passo_alvo.get('intencao_original')}\n- Elemento: {passo_alvo.get('_simlink', {}).get('target_text', '')}\n\n"
    
    if passo_seguinte:
        contexto += f"Passo Seguinte:\n- Intenção: {passo_seguinte.get('intencao_original')}\n- Âncora: {passo_seguinte.get('ancora')}\n- Micro: {passo_seguinte.get('micro_narracao')}\n"

    prompt = f"""Você é a Aura, Arquiteta de Conhecimento.
Sua missão é reescrever a narração do "PASSO A SER REGERADO" para que flua melhor.

Contexto dos cliques adjacentes:
{contexto}

Reescreva a "ancora" (o porquê/contexto) e a "micro_narracao" (a ação/o como) para este passo alvo, tornando-o mais didático e sem repetir palavras do passo anterior.
Responda APENAS com um objeto JSON:
{{
    "ancora": "sua nova âncora aqui",
    "micro_narracao": "sua nova micro narração aqui"
}}"""

    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.7
            )
        )
        resultado = json.loads(response.text)
        passo_alvo["ancora"] = resultado.get("ancora", "")
        passo_alvo["micro_narracao"] = resultado.get("micro_narracao", "")
        return json.loads(response.text)
    except Exception as e:
        logger.error(f"Erro ao regerar passo isolado (Gemini): {e}. Tentando OpenAI Fallback...")
        openai_key = os.getenv("OPENAI_API_KEY", "")
        if openai_key:
            try:
                openai_client = AsyncOpenAI(api_key=openai_key)
                completion = await openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "Você é a Aura. Retorne APENAS um objeto JSON válido, sem usar markdown ```json."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.7
                )
                res_text = completion.choices[0].message.content.strip()
                if res_text.startswith("```json"):
                    res_text = res_text[7:-3].strip()
                elif res_text.startswith("```"):
                    res_text = res_text[3:-3].strip()
                return json.loads(res_text)
            except Exception as e2:
                logger.error(f"Erro no Fallback OpenAI (Regerar Passo): {e2}")
        
        return passo_alvo
