import os
import base64
import logging
import asyncio
from video_eng.tts_generator import gerar_audio
from video_eng.time_bender import compose_video_with_freeze_frames
from api.intelligence_engine import processar_intencao, enriquecer_narrativa, gerar_titulo_inteligente
from api.status_manager import update_status
from api.finops_telemetry import FinOpsTracker
import json

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Defect 2 fix: double-click burst coalescing
# ---------------------------------------------------------------------------

# Maximum span (ms) between the first click and the closing dblclick of a
# same-target burst for it to be treated as a single double-click.
# The observed span in sess_1780690407909 was ~197ms; 400ms gives safe headroom.
COALESCE_WINDOW_MS = 400

# Pixel tolerance when comparing target_geometry coordinates (sameTarget).
_PIXEL_TOLERANCE = 10


def sameTarget(a: dict, b: dict, c: dict) -> bool:
    """Return True when three captured events target the same element.

    Compares ``eventData.xpath`` for exact equality and ``target_geometry``
    (x, y) within ``_PIXEL_TOLERANCE`` pixels.  Pure — no side effects.
    """
    def _ed(ev):
        return ev.get("eventData", {})

    def _xpath(ev):
        return _ed(ev).get("xpath", "")

    def _geom(ev):
        g = _ed(ev).get("target_geometry") or {}
        return g.get("x", 0), g.get("y", 0)

    if not (_xpath(a) == _xpath(b) == _xpath(c)):
        return False

    ax, ay = _geom(a)
    bx, by = _geom(b)
    cx, cy = _geom(c)
    return (
        abs(ax - bx) <= _PIXEL_TOLERANCE and abs(ay - by) <= _PIXEL_TOLERANCE and
        abs(ax - cx) <= _PIXEL_TOLERANCE and abs(ay - cy) <= _PIXEL_TOLERANCE
    )


def coalesce_dblclick_bursts(events: list, window_ms: int = COALESCE_WINDOW_MS) -> list:
    """Coalesce same-target click+click+dblclick bursts into a single dblclick event.

    Scans the ordered event list.  Whenever a run of three consecutive events
    satisfies ALL of:
      - events[i].eventData.action == "click"
      - events[i+1].eventData.action == "click"
      - events[i+2].eventData.action == "dblclick"
      - sameTarget(events[i], events[i+1], events[i+2])
      - events[i+2].timestamp - events[i].timestamp <= window_ms

    …the two leading click events are dropped and only the dblclick is kept.
    Every other event is left untouched and in order.

    Returns the input list unchanged when no qualifying burst exists.
    Pure — no side effects.
    """
    if len(events) < 3:
        return list(events)

    result = []
    i = 0
    while i < len(events):
        if i + 2 < len(events):
            a, b, c = events[i], events[i + 1], events[i + 2]

            def _action(ev):
                return ev.get("eventData", {}).get("action", "")

            def _ts(ev):
                return ev.get("timestamp", 0)

            if (
                _action(a) == "click"
                and _action(b) == "click"
                and _action(c) == "dblclick"
                and sameTarget(a, b, c)
                and (_ts(c) - _ts(a)) <= window_ms
            ):
                # Drop the two leading clicks; keep only the dblclick
                result.append(c)
                i += 3
                continue

        result.append(events[i])
        i += 1

    return result

async def renderizar_exportacao(payload: dict):
    """
    Orquestrador Completo (Em Background):
    1. Executa Gemini Vision.
    2. Executa Gemini Aura (Enriquecimento).
    3. Gera Áudios (TTS).
    4. Compõe o Vídeo Final.
    """
    session_id = payload.get("session_id", "sess_unknown")
    try:
        await _renderizar_exportacao_impl(payload, session_id)
    except Exception as e:
        logger.error(f"[{session_id}] Pipeline falhou com exceção não tratada: {e}", exc_info=True)
        try:
            FinOpsTracker.finish_job(session_id, pipeline_type="abandoned_or_error")
        except Exception as finops_err:
            logger.error(f"Erro ao finalizar FinOps no erro de pipeline: {finops_err}")
        update_status(session_id, "failed", f"Erro interno no pipeline: {e}")


async def _renderizar_exportacao_impl(payload: dict, session_id: str):
    start_time_ms = payload.get("recording_start_time", 0)
    user_id = payload.get("user_id")
    org_id = payload.get("org_id")
    FinOpsTracker.start_job(session_id, user_id=user_id, org_id=org_id)
    
    # 1. Salva o vídeo WebM Cru
    # Task 14.4: accept raw bytes from the binary upload (payload["video_bytes"])
    # instead of base64-decoding payload["video_webm"].
    raw_video_bytes = payload.get("video_bytes")
    if raw_video_bytes is None:
        # Backwards-compat fallback: old base64 path still works if caller uses it
        b64_video = payload.get("video_webm", "")
        if not b64_video:
            raise ValueError("Nenhum video recebido no payload (nem video_bytes nem video_webm).")
        b64_video = b64_video.split(',')[-1]
        raw_video_bytes = base64.b64decode(b64_video)
    elif not raw_video_bytes:
        raise ValueError("video_bytes recebido está vazio.")
        return
    
    os.makedirs("data/raw_videos", exist_ok=True)
    os.makedirs("data/videos_gerados", exist_ok=True)
    
    raw_webm_path = f"data/raw_videos/{session_id}_raw.webm"
    final_mp4_path = f"data/videos_gerados/{session_id}_final.mp4"
    
    with open(raw_webm_path, "wb") as f:
        f.write(raw_video_bytes)
    logger.info(f"Video WebM bruto salvo em {raw_webm_path}")
    
    modo_input = payload.get("modo_input", "A")
    transcricao_instrutor = None

    if modo_input == "B":
        # Task 14.4: accept raw audio bytes (payload["audio_bytes"]) first;
        # fall back to legacy base64 field (payload["audio_instrutor_webm"]) for
        # backwards compatibility.
        audio_raw = payload.get("audio_bytes")
        if audio_raw is None:
            b64_audio = payload.get("audio_instrutor_webm", "")
            if b64_audio:
                audio_raw = base64.b64decode(b64_audio.split(',')[-1])
        if audio_raw:
            update_status(session_id, "processing", "🎙️ Transcrevendo sua explicação...")
            from audio_eng.whisper_transcriber import transcrever_audio_instrutor
            transcricao_instrutor = await transcrever_audio_instrutor(
                audio_raw, session_id
            )

    if modo_input == "C" and payload.get("roteiro_manual"):
        roteiro_enriquecido = payload["roteiro_manual"]
    else:
        # --- 1. INTELIGÊNCIA VISUAL ---
        update_status(session_id, "processing", "✨ Assistente interpretando suas ações na tela...")
        # Defect 2 fix: coalesce click+click+dblclick bursts on the same target
        # into a single dblclick event BEFORE the per-event processar_evento
        # fan-out, so downstream enrichment/TTS/timeline see one step per burst.
        events = coalesce_dblclick_bursts(payload.get("events", []))
        
        from vision.som_annotator import anotar_imagem_coordenadas
        
        os.makedirs(f"data/simlink_screenshots/{session_id}", exist_ok=True)
        
        async def processar_evento(idx: int, ev: dict) -> dict:
            passo = idx + 1
            event_data = ev.get('eventData', {})
            a11y_tree = event_data.get('a11y_tree', [])

            # Filtrar eventos de navigation/loading — não precisam de Vision AI
            action = event_data.get("action", "click")
            if action == "navigation":
                return {
                    "passo": passo,
                    "timestamp": ev.get("timestamp"),
                    "intencao_original": "",
                    "_simlink": {
                        "xpath": "",
                        "selector": "",
                        "coordinates": {},
                        "target_text": "",
                        "action": "navigation",
                        "url": event_data.get("url", ""),
                        "screenshot_path": ""
                    }
                }
            
            b64_data = ev.get('screenshotData', '')
            if not b64_data and ev.get('screenshot'):
                b64_data = ev['screenshot']
                
            b64_data = b64_data.split(',')[-1] if b64_data else ""
            raw_bytes = base64.b64decode(b64_data) if b64_data else b""
            
            # Salvar screenshot original para o Simlink
            screenshot_path = ""
            if raw_bytes:
                screenshot_path = f"data/simlink_screenshots/{session_id}/passo_{passo}.png"
                with open(screenshot_path, "wb") as f:
                    f.write(raw_bytes)
            
            boxes = []
            for node in a11y_tree:
                geom = node.get('geometry')
                if geom:
                    boxes.append({
                        "idx": node.get("som_id"),
                        "x": geom["x"],
                        "y": geom["y"],
                        "w": geom["w"],
                        "h": geom["h"]
                    })
            
            annotated_bytes = raw_bytes
            if raw_bytes and boxes:
                try:
                    annotated_bytes = anotar_imagem_coordenadas(raw_bytes, boxes)
                except:
                    pass
                    
            try:
                resultado = await processar_intencao(annotated_bytes, event_data, a11y_tree, session_id=session_id)
                return {
                    "passo": passo,
                    "timestamp": ev.get("timestamp"),
                    "intencao_original": resultado.get("intencao_detalhada", "") if isinstance(resultado, dict) else str(resultado),
                    "_simlink": {
                        "xpath": event_data.get("xpath", ""),
                        "selector": event_data.get("css_selector", ""),
                        "confianca_captura": event_data.get("confianca_captura", "alta"),
                        "seletor_candidatos": event_data.get("seletor_candidatos", []),
                        "coordinates": event_data.get("target_geometry", {}),
                        "target_text": event_data.get("target_text", ""),
                        "action": event_data.get("action", "click"),
                        "url": event_data.get("url", ""),
                        "screenshot_path": screenshot_path
                    }
                }
            except Exception as e:
                logger.error(f"Erro no evento {passo}: {e}")
                return {"passo": passo, "timestamp": ev.get("timestamp"), "intencao_original": "", "_simlink": {}}

        semaphore = asyncio.Semaphore(8)
        
        async def processar_com_semaforo(idx: int, ev: dict) -> dict:
            async with semaphore:
                return await processar_evento(idx, ev)
                
        roteiro_raw = await asyncio.gather(*[
            processar_com_semaforo(idx, ev)
            for idx, ev in enumerate(events)
        ])
        roteiro = list(roteiro_raw)

        # --- 2. ENRIQUECIMENTO SEMÂNTICO ---
        update_status(session_id, "processing", "✍️ Assistente montando o roteiro do seu tutorial...")
        rag_namespace = payload.get("rag_namespace", "auto")
        try:
            roteiro_enriquecido = await enriquecer_narrativa(roteiro, transcricao_instrutor, rag_namespace, session_id=session_id)
        except Exception as e:
            logger.error(f"Erro no enriquecimento da narrativa: {e}")
            roteiro_enriquecido = roteiro

        # Limpar passos vazios e re-numerar os passos regulares
        roteiro_limpo = []
        contador_passos = 1
        for p in roteiro_enriquecido:
            num = str(p.get("passo", ""))
            if num == "0" or num == "999":
                roteiro_limpo.append(p)
                continue
            
            # Verifica se o passo tem algum conteúdo válido
            ancora = str(p.get("ancora", "")).replace("(vazio)", "").strip()
            micro = str(p.get("micro_narracao", "")).replace("(vazio)", "").strip()
            intencao = str(p.get("intencao_original", "")).replace("(vazio)", "").strip()
            
            if not ancora and not micro and not intencao:
                # Pula este passo completamente, pois está vazio (ex: navigation)
                continue
            
            # Reatribui o número do passo para garantir sequencialidade sem buracos
            p["passo"] = contador_passos
            roteiro_limpo.append(p)
            contador_passos += 1
            
        roteiro_enriquecido = roteiro_limpo

        # --- 3. GERAR TÍTULO INTELIGENTE ---
        update_status(session_id, "processing", "🧠 Extraindo intenção para gerar título...")
        try:
            titulo_inteligente = await gerar_titulo_inteligente(roteiro_enriquecido, rag_namespace, session_id=session_id)
        except Exception as e:
            logger.error(f"Erro ao gerar titulo inteligente: {e}")
            titulo_inteligente = f"[{rag_namespace.upper()}] Tutorial" if rag_namespace != "auto" else "Tutorial"

    try:
        os.makedirs("data/roteiros", exist_ok=True)
        with open(f"data/roteiros/{session_id}.json", "w", encoding="utf-8") as f:
            json.dump({
                "session_id": session_id,
                "recording_start_time": start_time_ms,
                "titulo": titulo_inteligente,
                "roteiro": roteiro_enriquecido
            }, f, ensure_ascii=False, indent=2)
            
        with open(f"data/roteiros/{session_id}.jsonl", "w", encoding="utf-8") as f:
            for passo in roteiro_enriquecido:
                f.write(json.dumps(passo, ensure_ascii=False) + "\n")
    except Exception as e: 
        logger.error(f"Erro ao salvar JSON/JSONL: {e}")
    
    # --- FASE EXPRESS CONCLUÍDA ---
    # O pipeline pesado foi movido para o rerender_pipeline.py
    logger.info(f"Fase express concluída. Roteiro salvo em: data/roteiros/{session_id}.json")
    
    # Atualizar status para "roteiro_pronto"
    update_status(session_id, "roteiro_pronto", "Roteiro pronto para revisão!")
