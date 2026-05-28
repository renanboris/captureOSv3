import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)

async def reportar_conclusao_lms(
    callback_url: str,
    token: str,
    modulo_id: str,
    xp_total: int,
    xp_max: int,
    completado: bool
) -> bool:
    """
    Reporta conclusão do Simlink ao LMS via HTTP callback.
    """
    is_xapi = "/statements" in callback_url

    if is_xapi:
        payload = _montar_xapi_statement(modulo_id, xp_total, xp_max, completado)
        headers = {
            "Authorization": f"Basic {token}",
            "X-Experience-API-Version": "1.0.3",
            "Content-Type": "application/json"
        }
    else:
        # REST simples
        payload = {
            "modulo_id": modulo_id,
            "score": xp_total,
            "score_max": xp_max,
            "status": "completed" if completado else "incomplete",
            "passed": xp_total >= (xp_max * 0.6)  # 60% = aprovado
        }
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(callback_url, json=payload, headers=headers)
            response.raise_for_status()
            logger.info(f"LMS callback OK: {response.status_code}")
            return True
    except Exception as e:
        logger.error(f"Erro no LMS callback: {e}")
        return False

def _montar_xapi_statement(modulo_id: str, xp: int, xp_max: int, completado: bool) -> dict:
    return {
        "verb": {
            "id": "http://adlnet.gov/expapi/verbs/completed" if completado else "http://adlnet.gov/expapi/verbs/attempted",
            "display": {"pt-BR": "completou" if completado else "tentou"}
        },
        "object": {
            "id": f"https://captureos.app/modulos/{modulo_id}",
            "definition": {"type": "http://adlnet.gov/expapi/activities/simulation"}
        },
        "result": {
            "score": {"raw": xp, "max": xp_max, "scaled": round(xp / xp_max, 2) if xp_max > 0 else 0},
            "completion": completado,
            "success": xp >= (xp_max * 0.6)
        }
    }
