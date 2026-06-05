import os
import base64
import logging
import asyncio
from video_eng.tts_generator import gerar_audio
from video_eng.time_bender import compose_video_with_freeze_frames
from api.intelligence_engine import processar_intencao, enriquecer_narrativa
from api.status_manager import update_status
import json

logger = logging.getLogger(__name__)

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
        update_status(session_id, "failed", f"Erro interno no pipeline: {e}")


async def _renderizar_exportacao_impl(payload: dict, session_id: str):
    start_time_ms = payload.get("recording_start_time", 0)
    
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
        events = payload.get("events", [])
        
        from vision.som_annotator import anotar_imagem_coordenadas
        
        os.makedirs(f"data/simlink_screenshots/{session_id}", exist_ok=True)
        
        async def processar_evento(idx: int, ev: dict) -> dict:
            passo = idx + 1
            event_data = ev.get('eventData', {})
            a11y_tree = event_data.get('a11y_tree', [])
            
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
                resultado = await processar_intencao(annotated_bytes, event_data, a11y_tree)
                return {
                    "passo": passo,
                    "timestamp": ev.get("timestamp"),
                    "intencao_original": resultado.get("intencao_detalhada", "") if isinstance(resultado, dict) else str(resultado),
                    "_simlink": {
                        "xpath": event_data.get("xpath", ""),
                        "selector": event_data.get("css_selector", ""),
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
        try:
            roteiro_enriquecido = await enriquecer_narrativa(roteiro, transcricao_instrutor)
        except Exception as e:
            logger.error(f"Erro no enriquecimento da narrativa: {e}")
            roteiro_enriquecido = roteiro

    try:
        os.makedirs("data/roteiros", exist_ok=True)
        with open(f"data/roteiros/{session_id}.json", "w", encoding="utf-8") as f:
            json.dump({
                "session_id": session_id,
                "recording_start_time": start_time_ms,
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
