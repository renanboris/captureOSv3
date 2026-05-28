import os
import logging
import asyncio
from video_eng.tts_generator import gerar_audio
from video_eng.time_bender import compose_video_with_freeze_frames
from api.status_manager import update_status

logger = logging.getLogger(__name__)

async def rerenderizar_com_roteiro_aprovado(session_id: str, roteiro_aprovado: list):
    """
    Pipeline parcial para re-renderização pós-editor.
    Pula a parte visual/Aura.
    Gera apenas o TTS (Passo 3) e o Vídeo final (Passo 4).
    """
    raw_webm_path = f"data/raw_videos/{session_id}_raw.webm"
    final_mp4_path = f"data/videos_gerados/{session_id}_final.mp4"

    if not os.path.exists(raw_webm_path):
        logger.error(f"Vídeo original não encontrado para re-renderização: {raw_webm_path}")
        update_status(session_id, "error", "Vídeo original não encontrado para re-renderização")
        return

    # --- 3. CONSTRUIR ÁUDIOS ---
    update_status(session_id, "rendering_final", "🎙️ Gravando a locução final...")
    os.makedirs(f"data/audios/{session_id}", exist_ok=True)
    timeline_events = []
    
    for idx, passo in enumerate(roteiro_aprovado):
        timestamp_ms = passo.get("timestamp", 0)
        ancora = passo.get("ancora", "").strip()
        micro = passo.get("micro_narracao", "").strip()
        
        intencao_combinada = f"{ancora} {micro}".strip()
        
        if not intencao_combinada:
            continue
        
        if timestamp_ms == 0 and passo.get("passo") == 0:
            rel_sec = 3.5
        elif timestamp_ms == 99999999 or passo.get("passo") == 999:
            rel_sec = timeline_events[-1]["timestamp"] + 3.0 if timeline_events else 5.0
        else:
            rel_sec = max(3.5, (timestamp_ms / 1000.0) - 0.6)
            
        audio_path = f"data/audios/{session_id}/passo_{idx+1}_final.mp3"
        sucesso_tts = await gerar_audio(intencao_combinada, audio_path)
        
        if sucesso_tts:
            timeline_events.append({
                "timestamp": rel_sec,
                "audio_path": audio_path
            })
            
    # --- 4. RENDERIZAÇÃO DE VÍDEO ---
    update_status(session_id, "rendering_final", "🎬 Renderizando seu vídeo final aprovado...")
    
    await asyncio.to_thread(
        compose_video_with_freeze_frames,
        raw_webm_path,
        final_mp4_path,
        timeline_events
    )
    
    # Atualizar Módulo Simlink com o roteiro aprovado
    try:
        from simlink_eng.simlink_builder import construir_modulo_simlink
        import json
        video_url = f"http://localhost:8000/videos_gerados/{session_id}_final.mp4"
        simlink_modulo = construir_modulo_simlink(roteiro_aprovado, session_id, video_url)
        os.makedirs("data/simlink", exist_ok=True)
        with open(f"data/simlink/{session_id}.json", "w", encoding="utf-8") as f:
            json.dump(simlink_modulo.model_dump(), f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Erro ao atualizar Simlink no rerender: {e}")

    logger.info(f"Re-renderização Concluída! Veja: {final_mp4_path}")
    update_status(session_id, "completed", "Vídeo 100% Finalizado!")
