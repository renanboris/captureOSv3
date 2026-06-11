import os
import logging
import asyncio
from video_eng.tts_generator import gerar_audio
from video_eng.time_bender import compose_video_with_freeze_frames, DEFAULT_OVERLAY
from api.status_manager import update_status

logger = logging.getLogger("uvicorn.error")


def is_loading_step(passo: dict) -> bool:
    """
    Pure, side-effect-free classifier.
    Returns True when the roteiro step represents a loading/navigation transition,
    meaning time_bender should keep the recording playing instead of freezing.
    """
    return passo.get("_simlink", {}).get("action") == "navigation"


async def rerenderizar_com_roteiro_aprovado(session_id: str, roteiro_aprovado: list,
                                            usar_overlay: bool = True):
    """
    Pipeline parcial para re-renderização pós-editor.
    Pula a parte visual/Aura.
    Gera apenas o TTS (Passo 3) e o Vídeo final (Passo 4).

    Args:
        session_id: ID da sessão
        roteiro_aprovado: roteiro editado/aprovado
        usar_overlay: se True, aplica a moldura (overlay) no vídeo final
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

    # Palavras/frases que indicam passo sem conteúdo útil para narração
    _SKIP_TEXTS = {"", "vazio", "(vazio)", "loading", "carregando", "-"}

    for idx, passo in enumerate(roteiro_aprovado):
        timestamp_ms = passo.get("timestamp", 0)
        ancora = passo.get("ancora", "").strip()
        micro = passo.get("micro_narracao", "").strip()
        
        intencao_combinada = f"{ancora} {micro}".strip()
        
        # Pular passos sem texto ou com placeholder
        if not intencao_combinada or intencao_combinada.lower() in _SKIP_TEXTS:
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
            "rel_sec": rel_sec,
            "is_loading": is_loading_step(passo)
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
            event: dict = {
                "timestamp": task_info["rel_sec"],
                "audio_path": task_info["audio_path"]
            }
            if task_info["is_loading"]:
                event["is_loading"] = True
            timeline_events.append(event)
            
    # --- 4. RENDERIZAÇÃO DE VÍDEO ---
    update_status(session_id, "rendering_final", "🎬 Renderizando seu vídeo final aprovado...")

    overlay_path = DEFAULT_OVERLAY if usar_overlay else None

    await asyncio.to_thread(
        compose_video_with_freeze_frames,
        raw_webm_path,
        final_mp4_path,
        timeline_events,
        overlay_path
    )
    
    # --- 5. GERAÇÃO DE ARTEFATOS PARALELOS ---
    update_status(session_id, "rendering_final", "📄 Gerando materiais de apoio...")
    logger.info(f"[{session_id}] Iniciando geração de materiais de apoio...")

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
    logger.info(f"[{session_id}] Gerando PDF e transcrição...")
    await asyncio.gather(
        asyncio.to_thread(gerar_pdf, roteiro_aprovado, pdf_path, f"Tutorial — Sessão {session_id}"),
        asyncio.to_thread(gerar_transcricao, roteiro_aprovado, transcript_path)
    )
    logger.info(f"[{session_id}] PDF e transcrição concluídos.")

    # Quiz (com timeout de 60s para não travar o pipeline)
    logger.info(f"[{session_id}] Gerando quiz via IA...")
    quiz_data = []
    try:
        quiz_data = await asyncio.wait_for(gerar_quiz(roteiro_aprovado), timeout=60.0)
        logger.info(f"[{session_id}] Quiz gerado com sucesso ({len(quiz_data)} questões).")
    except asyncio.TimeoutError:
        logger.error(f"[{session_id}] Quiz timeout (60s) — pulando geração de quiz.")
    except Exception as e:
        logger.error(f"[{session_id}] Erro ao gerar quiz: {e}")

    quiz_path = f"data/artifacts/{session_id}/quiz.json"
    if quiz_data:
        with open(quiz_path, "w", encoding="utf-8") as f:
            import json
            json.dump(quiz_data, f, ensure_ascii=False, indent=2)

    # Atualizar Módulo Simlink com o roteiro aprovado
    try:
        video_url = f"{settings.backend_url}/videos_gerados/{session_id}_final.mp4"
        simlink_modulo = construir_modulo_simlink(roteiro_aprovado, session_id, video_url)

        # Anexar áudio de intro (passo 0 / boas-vindas) ao módulo
        intro_audio_path = f"data/audios/{session_id}/passo_1_final.mp3"
        if os.path.exists(intro_audio_path):
            simlink_modulo.intro_audio_filename = os.path.basename(intro_audio_path)
            logger.info(f"[{session_id}] Intro audio: {simlink_modulo.intro_audio_filename}")

        os.makedirs("data/simlink", exist_ok=True)
        with open(f"data/simlink/{session_id}.json", "w", encoding="utf-8") as f:
            import json
            json.dump(simlink_modulo.model_dump(), f, ensure_ascii=False, indent=2)

        # Gerar pacote SCORM: inclui quiz automaticamente se já foi gerado pela IA
        from scorm_eng.scorm_builder import gerar_scorm
        titulo = f"Tutorial — Sessão {session_id}"
        quiz_path = f"data/artifacts/{session_id}/quiz.json"
        incluir_quiz = os.path.exists(quiz_path) and os.path.getsize(quiz_path) > 10
        scorm_path = await gerar_scorm(
            simlink_modulo,
            session_id,
            titulo,
            incluir_quiz=incluir_quiz,
            quiz_data_path=quiz_path if incluir_quiz else None
        )
        logger.info(f"Pacote SCORM gerado em: {scorm_path} (quiz={'sim' if incluir_quiz else 'não'})")

    except Exception as e:
        logger.error(f"Erro ao atualizar Simlink/SCORM no rerender: {e}")

    logger.info(f"Re-renderização Concluída! Veja: {final_mp4_path}")
    update_status(session_id, "completed", "Vídeo 100% Finalizado!")
