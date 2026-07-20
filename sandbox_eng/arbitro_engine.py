import json
import logging
import hashlib
import os
from datetime import datetime, timezone
from google import genai
from google.genai import types as genai_types
from config.settings import get_settings
from config.prompt_loader import load_system_instruction
from config.genai_client import get_genai_client
from api.db_services import get_supabase_client

logger = logging.getLogger(__name__)

PROMPT_ARBITRO = "arbitro_sandbox.v1.txt"


def eh_seletor_fragil(seletor: str) -> bool:
    if not seletor:
        return False
    # Padrões posicionais CSS ou XPath frágeis
    fragile_patterns = [":nth-child", ":nth-of-type", "[", "]"]
    # Se contém colchetes e números dentro de colchetes (ex: /li[2]/span)
    for pattern in fragile_patterns:
        if pattern in seletor:
            # XPath posicional ou nth-child detectado
            if ":" in pattern or ("[" in seletor and any(char.isdigit() for char in seletor)):
                return True
    return False


def verificar_identidade(expected_text: str, actual_text: str) -> bool:
    if not expected_text:
        return True # Fail-open
    if not actual_text:
        return False
    return expected_text.strip().lower() == actual_text.strip().lower()


def calcular_hash_intencao(modulo_id: str, passo: int, label_esperado: str) -> str:
    norm_label = (label_esperado or "").strip().lower()
    raw = f"{modulo_id}:{passo}:{norm_label}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def buscar_memoria_semantica_global(org_id: str, label_esperado: str):
    """
    Busca na memória semântica da organização se já existe um seletor aprovado
    para um elemento/rótulo recorrente em QUALQUER módulo anterior da mesma org.
    """
    if not org_id or not label_esperado or len(label_esperado.strip()) < 2:
        return None
    client = get_supabase_client()
    if not client:
        return None
    try:
        norm_label = label_esperado.strip().lower()
        res = client.table("memoria_semantica").select("*").eq("org_id", org_id).eq("falhas_consecutivas", 0).order("hits", desc=True).limit(50).execute()
        if res.data:
            for rec in res.data:
                seletor = rec.get("seletor", "")
                if norm_label in seletor.lower() or norm_label in rec.get("hash_intencao", "").lower():
                    return rec
    except Exception as e:
        logger.error(f"Erro ao buscar memoria semantica global para org {org_id}: {e}")
    return None


def buscar_memoria_semantica(org_id: str, modulo_id: str, hash_intencao: str, label_esperado: str = None):
    client = get_supabase_client()
    if not client:
        return None
    try:
        res = client.table("memoria_semantica").select("*").eq("org_id", org_id).eq("modulo_id", modulo_id).eq("hash_intencao", hash_intencao).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]
            
        # Fallback para busca global por organização (cross-modulo) se o rótulo for fornecido
        if label_esperado:
            return buscar_memoria_semantica_global(org_id, label_esperado)
    except Exception as e:
        logger.error(f"Erro ao buscar memoria semantica: {e}")
    return None


def salvar_memoria_semantica(org_id: str, modulo_id: str, hash_intencao: str, estrategia: str, seletor: str):
    client = get_supabase_client()
    if not client:
        return
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        res = client.table("memoria_semantica").select("id, hits").eq("org_id", org_id).eq("modulo_id", modulo_id).eq("hash_intencao", hash_intencao).execute()
        if res.data and len(res.data) > 0:
            record_id = res.data[0]["id"]
            hits = res.data[0].get("hits", 0) + 1
            client.table("memoria_semantica").update({
                "estrategia_vencedora": estrategia,
                "seletor": seletor,
                "hits": hits,
                "falhas_consecutivas": 0,
                "ultimo_uso": now_iso
            }).eq("id", record_id).execute()
        else:
            client.table("memoria_semantica").insert({
                "org_id": org_id,
                "modulo_id": modulo_id,
                "hash_intencao": hash_intencao,
                "estrategia_vencedora": estrategia,
                "seletor": seletor,
                "hits": 1,
                "falhas_consecutivas": 0,
                "ultimo_uso": now_iso
            }).execute()
    except Exception as e:
        logger.error(f"Erro ao salvar memoria semantica: {e}")


def registrar_falha_memoria(org_id: str, modulo_id: str, hash_intencao: str, record: dict):
    client = get_supabase_client()
    if not client or not record:
        return
    try:
        falhas = record.get("falhas_consecutivas", 0) + 1
        if falhas >= 3 and not record.get("hitl_corrigido", False):
            client.table("memoria_semantica").delete().eq("id", record["id"]).execute()
            logger.info(f"Registro de memoria {record['id']} deletado após {falhas} falhas consecutivas.")
        else:
            client.table("memoria_semantica").update({
                "falhas_consecutivas": falhas
            }).eq("id", record["id"]).execute()
    except Exception as e:
        logger.error(f"Erro ao registrar falha na memoria: {e}")


def registrar_telemetria_arbitro(org_id: str, modulo_id: str, passo: int, camada: str, sucesso: bool):
    data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "org_id": org_id,
        "modulo_id": modulo_id,
        "passo": passo,
        "camada": camada,
        "sucesso": sucesso
    }
    try:
        os.makedirs("data", exist_ok=True)
        with open("data/arbitro_telemetria.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(data) + "\n")
    except Exception as e:
        logger.error(f"Erro ao salvar telemetria local do arbitro: {e}")


async def avaliar_acao_sandbox(roteiro: list, passo_esperado: int, action_data: dict, org_id: str = None, modulo_id: str = None) -> dict:
    """
    Avalia se o clique atual corresponde ao esperado no roteiro.
    """
    if passo_esperado > len(roteiro):
        return {"is_correct": False, "hint": "Você já concluiu o tutorial!"}

    passo_atual_dados = roteiro[passo_esperado - 1]

    simlink_data = passo_atual_dados.get('_simlink', {})
    expected_text = simlink_data.get('target_text', '')
    expected_selector = simlink_data.get('selector', '')
    expected_xpath = simlink_data.get('xpath', '')

    actual_text = action_data.get('target_text', '')
    actual_selector = action_data.get('css_selector', '')
    actual_xpath = action_data.get('xpath', '')

    hash_intencao = None
    memoria_record = None

    if org_id and modulo_id:
        hash_intencao = calcular_hash_intencao(modulo_id, passo_esperado, expected_text)
        memoria_record = buscar_memoria_semantica(org_id, modulo_id, hash_intencao, expected_text)

    # Camada 0: Brain Cache Lookup
    if memoria_record:
        estrategia = memoria_record.get("estrategia_vencedora")
        seletor_memorizado = memoria_record.get("seletor")
        
        # Desconfiança: ignorar cache se o seletor for frágil e não houver rótulo esperado
        ignorar_cache = eh_seletor_fragil(seletor_memorizado) and not expected_text

        if not ignorar_cache:
            if estrategia == "css_selector" and actual_selector == seletor_memorizado:
                identidade_ok = verificar_identidade(expected_text, actual_text)
                if identidade_ok:
                    salvar_memoria_semantica(org_id, modulo_id, hash_intencao, estrategia, seletor_memorizado)
                    registrar_telemetria_arbitro(org_id, modulo_id, passo_esperado, "0_brain", True)
                    return {"is_correct": True, "hint": ""}
                else:
                    logger.warning(
                        f"[Brain] Identidade do elemento não confirmada: "
                        f"esperado '{expected_text}', obtido '{actual_text}' para seletor '{seletor_memorizado}'"
                    )
                    registrar_falha_memoria(org_id, modulo_id, hash_intencao, memoria_record)
                    registrar_telemetria_arbitro(org_id, modulo_id, passo_esperado, "0_brain", False)
            elif estrategia == "xpath" and actual_xpath == seletor_memorizado:
                identidade_ok = verificar_identidade(expected_text, actual_text)
                if identidade_ok:
                    salvar_memoria_semantica(org_id, modulo_id, hash_intencao, estrategia, seletor_memorizado)
                    registrar_telemetria_arbitro(org_id, modulo_id, passo_esperado, "0_brain", True)
                    return {"is_correct": True, "hint": ""}
                else:
                    logger.warning(
                        f"[Brain] Identidade do elemento não confirmada: "
                        f"esperado '{expected_text}', obtido '{actual_text}' para XPath '{seletor_memorizado}'"
                    )
                    registrar_falha_memoria(org_id, modulo_id, hash_intencao, memoria_record)
                    registrar_telemetria_arbitro(org_id, modulo_id, passo_esperado, "0_brain", False)
            elif estrategia in ("texto", "gemini_vision"):
                seletor_match = (actual_selector == seletor_memorizado or actual_xpath == seletor_memorizado)
                identidade_ok = verificar_identidade(expected_text, actual_text)
                if seletor_match and identidade_ok:
                    salvar_memoria_semantica(org_id, modulo_id, hash_intencao, estrategia, seletor_memorizado)
                    registrar_telemetria_arbitro(org_id, modulo_id, passo_esperado, "0_brain", True)
                    return {"is_correct": True, "hint": ""}
                elif seletor_match and not identidade_ok:
                    logger.warning(
                        f"[Brain] Identidade do elemento não confirmada: "
                        f"esperado '{expected_text}', obtido '{actual_text}' para {estrategia} '{seletor_memorizado}'"
                    )
                    registrar_falha_memoria(org_id, modulo_id, hash_intencao, memoria_record)
                    registrar_telemetria_arbitro(org_id, modulo_id, passo_esperado, "0_brain", False)

    # Validação Primária (Rápida) - Camadas 1, 2, 3
    match_text = expected_text and actual_text and (expected_text.lower() in actual_text.lower() or actual_text.lower() in expected_text.lower())
    match_selector = expected_selector and actual_selector and expected_selector == actual_selector
    match_xpath = expected_xpath and actual_xpath and expected_xpath == actual_xpath

    if match_selector:
        if org_id and modulo_id and hash_intencao:
            salvar_memoria_semantica(org_id, modulo_id, hash_intencao, 'css_selector', expected_selector)
            registrar_telemetria_arbitro(org_id, modulo_id, passo_esperado, "1_selector", True)
        return {"is_correct": True, "hint": ""}

    if match_xpath:
        if org_id and modulo_id and hash_intencao:
            salvar_memoria_semantica(org_id, modulo_id, hash_intencao, 'xpath', expected_xpath)
            registrar_telemetria_arbitro(org_id, modulo_id, passo_esperado, "2_xpath", True)
        return {"is_correct": True, "hint": ""}

    if match_text and len(expected_text) > 3:
        if org_id and modulo_id and hash_intencao:
            salvar_memoria_semantica(org_id, modulo_id, hash_intencao, 'texto', actual_selector or expected_selector)
            registrar_telemetria_arbitro(org_id, modulo_id, passo_esperado, "3_text", True)
        return {"is_correct": True, "hint": ""}

    # Camada 4: Gemini Vision Fallback
    settings = get_settings()
    try:
        client = get_genai_client()
    except RuntimeError:
        return {"is_correct": True, "hint": "Sem credenciais Google AI para avaliar"}

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
        result = json.loads(response.text)
        
        is_correct = result.get("is_correct", False)
        registrar_telemetria_arbitro(org_id, modulo_id, passo_esperado, "4_gemini_vision", is_correct)
        
        if is_correct and org_id and modulo_id and hash_intencao:
            # Salvar o seletor real clicado pelo aluno na memória com rótulo gemini_vision
            salvar_memoria_semantica(org_id, modulo_id, hash_intencao, 'gemini_vision', actual_selector or expected_selector)
            
        return result
    except Exception as e:
        logger.error(f"Erro no árbitro: {e}")
        registrar_telemetria_arbitro(org_id, modulo_id, passo_esperado, "4_gemini_vision", False)
        return {"is_correct": False, "hint": "Não consegui validar agora. Tente novamente."}
