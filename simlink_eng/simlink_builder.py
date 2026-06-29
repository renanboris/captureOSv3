import json
import uuid
import logging
from datetime import datetime
from contracts.simlink_models import SimlinkModulo, SimlinkHotspot

logger = logging.getLogger(__name__)

def construir_modulo_simlink(roteiro_enriquecido: list, session_id: str, video_url: str, titulo: str = "") -> SimlinkModulo:
    """
    Constrói o módulo Simlink a partir do roteiro já enriquecido.
    """
    hotspots = []

    for idx, passo in enumerate(roteiro_enriquecido):
        num = passo.get("passo", 0)
        if num in (0, 999):
            continue  # Intro e conclusão não têm hotspot

        simlink_data = passo.get("_simlink", {})
        if not simlink_data.get("xpath") and not simlink_data.get("coordinates"):
            logger.warning(f"Passo {num} sem dados de hotspot — pulando")
            continue

        # Pular passos sem conteúdo textual (loading/navegação vazia)
        ancora = passo.get("ancora", "").strip().replace("(vazio)", "").strip()
        micro = passo.get("micro_narracao", "").strip().replace("(vazio)", "").strip()
        if not ancora and not micro:
            logger.info(f"Passo {num} sem texto (ancora/micro vazio) — pulando do simlink")
            continue
            
        audio_path = f"data/audios/{session_id}/passo_{idx+1}_final.mp3"

        hotspots.append(SimlinkHotspot(
            passo_num=num,
            xpath=simlink_data.get("xpath", ""),
            css_selector=simlink_data.get("selector", ""),
            coordinates=simlink_data.get("coordinates", {}),
            target_text=simlink_data.get("target_text", ""),
            action=simlink_data.get("action", "click"),
            url=simlink_data.get("url", ""),
            screenshot_path=simlink_data.get("screenshot_path", ""),
            ancora=passo.get("ancora", ""),
            micro_narracao=passo.get("micro_narracao", ""),
            audio_path=audio_path
        ))

    xp_max = len(hotspots) * 10 + 20  # +20 = bônus sequência perfeita
    
    # Descobrir domínio baseado no primeiro url útil
    dominio = ""
    for h in hotspots:
        if h.url:
            try:
                from urllib.parse import urlparse
                dominio = urlparse(h.url).netloc
                break
            except:
                pass

    modulo = SimlinkModulo(
        modulo_id=str(uuid.uuid4()),
        session_id=session_id,
        titulo=titulo or f"Tutorial — {session_id[:8]}",
        dominio=dominio,
        total_passos=len(hotspots),
        hotspots=hotspots,
        video_url=video_url,
        xp_max=xp_max,
        criado_em=datetime.now().isoformat()
    )

    return modulo
