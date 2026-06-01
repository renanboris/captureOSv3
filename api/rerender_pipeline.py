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

    # NOVO: ler start_time_ms do roteiro salvo originalmente
    import json
    start_time_ms = 0
    roteiro_path = f"data/roteiros/{session_id}.json"
    if os.path.exists(roteiro_path):
        try:
            with open(roteiro_path) as f:
                saved = json.load(f)
                start_time_ms = saved.get("recording_start_time", 0)
        except Exception as e:
            logger.warning(f"Não foi possível ler start_time_ms: {e}")

    # --- 3. CONSTRUIR ÁUDIOS ---
    update_status(session_id, "rendering_final", "🎙️ Gravando a locução final...")
    os.makedirs(f"data/audios/{session_id}", exist_ok=True)
    timeline_events = []
    
    # Pré-computar todas as tarefas de TTS (texto, caminho, timestamp) sequencialmente
    tts_tasks = []
    last_computed_ts = 5.0  # fallback para passo final se não houver eventos anteriores

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
            rel_sec = last_computed_ts + 3.0
        else:
            if start_time_ms > 0:
                rel_sec = max(3.5, ((timestamp_ms - start_time_ms) / 1000.0) - 0.6)
            else:
                rel_sec = max(3.5, (timestamp_ms / 1000.0) - 0.6)

        audio_path = f"data/audios/{session_id}/passo_{idx+1}_final.mp3"
        tts_tasks.append({
            "texto": intencao_combinada,
            "audio_path": audio_path,
            "rel_sec": rel_sec
        })
        last_computed_ts = rel_sec

    # Gerar TTS em paralelo com semáforo para limitar concorrência
    sem = asyncio.Semaphore(5)

    async def _gerar_com_semaforo(texto, audio_path):
        async with sem:
            return await gerar_audio(texto, audio_path)

    resultados = await asyncio.gather(
        *[_gerar_com_semaforo(t["texto"], t["audio_path"]) for t in tts_tasks]
    )

    # Montar timeline_events na ordem original, apenas com TTS bem-sucedidos
    for task_info, sucesso_tts in zip(tts_tasks, resultados):
        if sucesso_tts:
            timeline_events.append({
                "timestamp": task_info["rel_sec"],
                "audio_path": task_info["audio_path"]
            })
            
    # --- 4. RENDERIZAÇÃO DE VÍDEO ---
    update_status(session_id, "rendering_final", "🎬 Renderizando seu vídeo final aprovado...")
    
    await asyncio.to_thread(
        compose_video_with_freeze_frames,
        raw_webm_path,
        final_mp4_path,
        timeline_events
    )
    
    # --- 5. GERAÇÃO DE ARTEFATOS PARALELOS ---
    update_status(session_id, "rendering_final", "📄 Gerando materiais de apoio...")

    os.makedirs(f"data/artifacts/{session_id}", exist_ok=True)
    pdf_path = f"data/artifacts/{session_id}/apostila.pdf"
    transcript_path = f"data/artifacts/{session_id}/transcricao.txt"

    from pdf_eng.manual_builder import gerar_pdf
    from artifacts.transcript_builder import gerar_transcricao
    from artifacts.quiz_generator import gerar_quiz
    from config.settings import get_settings
    from simlink_eng.simlink_builder import construir_modulo_simlink

    settings = get_settings()

    # Rodar PDF e transcrição em paralelo
    await asyncio.gather(
        asyncio.to_thread(gerar_pdf, roteiro_aprovado, pdf_path, f"Tutorial — Sessão {session_id}"),
        asyncio.to_thread(gerar_transcricao, roteiro_aprovado, transcript_path)
    )

    # Quiz
    quiz_data = await gerar_quiz(roteiro_aprovado, settings.google_api_key)
    quiz_path = f"data/artifacts/{session_id}/quiz.json"
    if quiz_data:
        with open(quiz_path, "w", encoding="utf-8") as f:
            import json
            json.dump(quiz_data, f, ensure_ascii=False, indent=2)

    # Atualizar Módulo Simlink com o roteiro aprovado
    try:
        video_url = f"{settings.backend_url}/videos_gerados/{session_id}_final.mp4"
        simlink_modulo = construir_modulo_simlink(roteiro_aprovado, session_id, video_url)
        os.makedirs("data/simlink", exist_ok=True)
        with open(f"data/simlink/{session_id}.json", "w", encoding="utf-8") as f:
            import json
            json.dump(simlink_modulo.model_dump(), f, ensure_ascii=False, indent=2)
            
        # NOVO: Gerar pacote SCORM (TRY mode) automaticamente
        from scorm_eng.scorm_builder import gerar_scorm
        titulo = f"Tutorial — Sessão {session_id}"
        scorm_path = gerar_scorm(simlink_modulo, session_id, titulo)
        logger.info(f"Pacote SCORM gerado em: {scorm_path}")
        
    except Exception as e:
        logger.error(f"Erro ao atualizar Simlink/SCORM no rerender: {e}")

    logger.info(f"Re-renderização Concluída! Veja: {final_mp4_path}")
    update_status(session_id, "completed", "Vídeo 100% Finalizado!")
