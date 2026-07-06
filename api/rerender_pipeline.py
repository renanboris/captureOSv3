import os
import logging
import asyncio
from video_eng.tts_generator import gerar_audio
from video_eng.time_bender import compose_video_with_freeze_frames, DEFAULT_OVERLAY, _get_media_duration
from api.status_manager import update_status
from api.finops_telemetry import FinOpsTracker

logger = logging.getLogger("uvicorn.error")


def is_loading_step(passo: dict) -> bool:
    """
    Pure, side-effect-free classifier.
    Returns True when the roteiro step represents a loading/navigation transition,
    meaning time_bender should keep the recording playing instead of freezing.
    """
    return passo.get("_simlink", {}).get("action") == "navigation"


async def rerenderizar_com_roteiro_aprovado(session_id: str, roteiro_aprovado: list,
                                            usar_overlay: bool = True, voice_id: str = "Portuguese_Casual_Speaker_v1"):
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
        
        passo_num = str(passo.get("passo", ""))
        
        if timestamp_ms == 0 and passo_num == "0":
            rel_sec = 0.0
        elif timestamp_ms == 99999999 or passo_num == "999":
            # 999999 será capado pelo video_duration no time_bender, garantindo que o vídeo corra solto até o fim
            rel_sec = 999999.0
        else:
            if start_time_ms > 0:
                rel_sec = max(0.0, ((timestamp_ms - start_time_ms) / 1000.0) - 0.6)
            else:
                rel_sec = max(0.0, (timestamp_ms / 1000.0) - 0.6)

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
            return await gerar_audio(texto, audio_path, voice_id)

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
    
    # --- CAPTURA DE DURAÇÃO PARA FINOPS ANTES DO UPLOAD ---
    try:
        if os.path.exists(final_mp4_path):
            video_dur = _get_media_duration(final_mp4_path)
            FinOpsTracker.set_video_duration(session_id, video_dur)
    except Exception as e:
        logger.error(f"Erro ao obter duração do vídeo para FinOps: {e}")
    
    # Faz o upload para a nuvem (Supabase)
    update_status(session_id, "rendering_final", "☁️ Fazendo upload do vídeo para a nuvem...")
    from api.storage import upload_video
    public_url = await asyncio.to_thread(upload_video, final_mp4_path, session_id)
    if public_url:
        logger.info(f"[{session_id}] Vídeo disponível na nuvem: {public_url}")
    
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

    # Ler título do JSON
    titulo_amigavel = "Treinamento Prático"
    import json
    roteiro_json_path = f"data/roteiros/{session_id}.json"
    if os.path.exists(roteiro_json_path):
        try:
            with open(roteiro_json_path, "r", encoding="utf-8") as f:
                roteiro_data = json.load(f)
                if roteiro_data.get("titulo"):
                    titulo_amigavel = roteiro_data.get("titulo")
        except:
            pass

    # Rodar PDF e transcrição em paralelo
    logger.info(f"[{session_id}] Gerando PDF e transcrição...")
    await asyncio.gather(
        asyncio.to_thread(gerar_pdf, roteiro_aprovado, pdf_path, titulo_amigavel),
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
        video_url = public_url if public_url else f"{settings.backend_url}/videos_gerados/{session_id}_final.mp4"
        simlink_modulo = construir_modulo_simlink(roteiro_aprovado, session_id, video_url, titulo=titulo_amigavel)
        os.makedirs("data/simlink", exist_ok=True)
        with open(f"data/simlink/{session_id}.json", "w", encoding="utf-8") as f:
            import json
            json.dump(simlink_modulo.model_dump(), f, ensure_ascii=False, indent=2)

        # Gerar pacote SCORM
        update_status(session_id, "rendering_final", "📦 Empacotando SCORM para LMS...")
        try:
            from scorm_eng.scorm_builder import gerar_scorm
            scorm_path = await gerar_scorm(simlink_modulo, session_id, titulo_amigavel)
            logger.info(f"Pacote SCORM gerado em: {scorm_path}")
        except Exception as e:
            logger.error(f"Falha ao empacotar SCORM: {e}")
    except Exception as e:
        logger.error(f"Erro ao atualizar Simlink/SCORM no rerender: {e}")

    # --- FECHAMENTO FINOPS ---
    try:
        finops_result = FinOpsTracker.finish_job(session_id, pipeline_type="rerender")
        if finops_result:
            logger.info(f"[{session_id}] FinOps Metric: Custo total estimado: ${finops_result.get('estimated_api_cost_usd', 0):.4f} | CpM: ${finops_result.get('api_cost_per_minute_usd', 0):.4f}")
    except Exception as e:
        logger.error(f"Erro ao finalizar FinOpsTracker: {e}")

    logger.info(f"Re-renderização Concluída! Veja: {final_mp4_path}")
    update_status(session_id, "completed", "Vídeo 100% Finalizado!")
