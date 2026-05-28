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
    start_time_ms = payload.get("recording_start_time", 0)
    
    # 1. Salva o vídeo WebM Cru
    b64_video = payload.get("video_webm")
    if not b64_video:
        logger.error("Nenhum video_webm recebido no payload.")
        return
        
    b64_video = b64_video.split(',')[-1]
    raw_video_bytes = base64.b64decode(b64_video)
    
    os.makedirs("data/raw_videos", exist_ok=True)
    os.makedirs("data/videos_gerados", exist_ok=True)
    
    raw_webm_path = f"data/raw_videos/{session_id}_raw.webm"
    final_mp4_path = f"data/videos_gerados/{session_id}_final.mp4"
    
    with open(raw_webm_path, "wb") as f:
        f.write(raw_video_bytes)
    logger.info(f"Video WebM bruto salvo em {raw_webm_path}")
    
    modo_input = payload.get("modo_input", "A")
    transcricao_instrutor = None

    if modo_input == "B" and payload.get("audio_instrutor_webm"):
        update_status(session_id, "processing", "🎙️ Transcrevendo sua explicação...")
        from audio_eng.whisper_transcriber import transcrever_audio_instrutor
        transcricao_instrutor = await transcrever_audio_instrutor(
            payload["audio_instrutor_webm"], session_id
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
                        "selector": event_data.get("cssSelector", ""),
                        "coordinates": event_data.get("coordinates", {}),
                        "target_text": event_data.get("target_text", ""),
                        "action": event_data.get("action", "click"),
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
            json.dump({"session_id": session_id, "roteiro": roteiro_enriquecido}, f, ensure_ascii=False, indent=2)
            
        with open(f"data/roteiros/{session_id}.jsonl", "w", encoding="utf-8") as f:
            for passo in roteiro_enriquecido:
                f.write(json.dumps(passo, ensure_ascii=False) + "\n")
    except Exception as e: 
        logger.error(f"Erro ao salvar JSON/JSONL: {e}")
    
    # --- 3. CONSTRUIR ÁUDIOS ---
    update_status(session_id, "processing", "🎙️ Assistente gravando a locução profissional...")
    os.makedirs(f"data/audios/{session_id}", exist_ok=True)
    timeline_events = []
    
    for idx, passo in enumerate(roteiro_enriquecido):
        timestamp_ms = passo.get("timestamp", 0)
        ancora = passo.get("ancora", "").strip()
        micro = passo.get("micro_narracao", "").strip()
        
        # Concatena a âncora (Big Picture) e a micro narração (Instrução Tática)
        intencao_combinada = f"{ancora} {micro}".strip()
        
        # Se não houver texto nenhum, pula a geração de áudio
        if not intencao_combinada:
            continue
        
        # O tempo relativo em segundos dentro do vídeo cru:
        if timestamp_ms == 0 and passo.get("passo") == 0:
            rel_sec = 3.5  # Introdução começa após o término do contador de 3 segundos
        elif timestamp_ms == 99999999 or passo.get("passo") == 999:
            # A conclusão será amarrada ao final do vídeo
            rel_sec = timeline_events[-1]["timestamp"] + 3.0 if timeline_events else 5.0
        elif start_time_ms > 0:
            # COMPENSAÇÃO DE DELAY (600ms): O MediaRecorder tem um pequeno atraso para iniciar,
            # e a página pode começar a transição imediatamente após o clique.
            # Subtraímos 0.6s para garantir que o frame congelado seja exatamente ANTES do clique.
            rel_sec = max(3.5, ((timestamp_ms - start_time_ms) / 1000.0) - 0.6)
        else:
            # Fallback
            rel_sec = 2.0 + (idx * 3.0) 
            
        # Gera o áudio
        audio_path = f"data/audios/{session_id}/passo_{idx+1}.mp3"
        sucesso_tts = await gerar_audio(intencao_combinada, audio_path)
        
        if sucesso_tts:
            timeline_events.append({
                "timestamp": rel_sec,
                "audio_path": audio_path
            })
            
    # --- 4. RENDERIZAÇÃO DE VÍDEO ---
    update_status(session_id, "processing", "🎬 Renderizando seu filme (Isso pode levar alguns minutos)...")
    # Chama o Time Bender (Processamento Pesado)
    logger.info("Iniciando Time Bender...")
    await asyncio.to_thread(
        compose_video_with_freeze_frames,
        raw_webm_path,
        final_mp4_path,
        timeline_events
    )
    
    logger.info(f"Exportação de Vídeo Concluída! Veja o resultado em: {final_mp4_path}")
    
    # --- 5. GERAÇÃO DE ARTEFATOS PARALELOS ---
    update_status(session_id, "processing", "📄 Gerando materiais de apoio...")

    os.makedirs(f"data/artifacts/{session_id}", exist_ok=True)
    pdf_path = f"data/artifacts/{session_id}/apostila.pdf"
    transcript_path = f"data/artifacts/{session_id}/transcricao.txt"

    from pdf_eng.manual_builder import gerar_pdf
    from artifacts.transcript_builder import gerar_transcricao
    from artifacts.quiz_generator import gerar_quiz
    from config.settings import get_settings

    settings = get_settings()

    # Rodar PDF e transcrição em paralelo (são síncronos, usar thread)
    await asyncio.gather(
        asyncio.to_thread(gerar_pdf, roteiro_enriquecido, pdf_path, f"Tutorial — Sessão {session_id}"),
        asyncio.to_thread(gerar_transcricao, roteiro_enriquecido, transcript_path)
    )

    # Quiz (assíncrono — chama Gemini)
    quiz_data = await gerar_quiz(roteiro_enriquecido, settings.google_api_key)

    # Salvar quiz como JSON
    quiz_path = f"data/artifacts/{session_id}/quiz.json"
    if quiz_data:
        with open(quiz_path, "w", encoding="utf-8") as f:
            json.dump(quiz_data, f, ensure_ascii=False, indent=2)

    # Construir e salvar Módulo Simlink
    from simlink_eng.simlink_builder import construir_modulo_simlink
    video_url = f"http://localhost:8000/videos_gerados/{session_id}_final.mp4"
    simlink_modulo = construir_modulo_simlink(roteiro_enriquecido, session_id, video_url)
    
    os.makedirs("data/simlink", exist_ok=True)
    with open(f"data/simlink/{session_id}.json", "w", encoding="utf-8") as f:
        json.dump(simlink_modulo.model_dump(), f, ensure_ascii=False, indent=2)

    # Atualizar status para "roteiro_pronto"
    update_status(session_id, "roteiro_pronto", "Roteiro pronto para revisão!")
