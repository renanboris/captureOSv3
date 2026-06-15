import os
import logging
import subprocess
import json
import shutil
# O FFmpeg deve estar instalado na máquina (ou contêiner Docker) e disponível no PATH.
# static_ffmpeg.add_paths() foi removido para evitar problemas multiplataforma.

logger = logging.getLogger(__name__)

FPS = 30
FRAME_DUR = 1.0 / FPS

# Overlay / Moldura — configuração
OVERLAY_DIR = os.path.join(os.path.dirname(__file__), "overlays")
DEFAULT_OVERLAY = os.path.join(OVERLAY_DIR, "intro.png")

# Cache de detecção do buraco transparente por caminho de overlay
_overlay_hole_cache = {}


def _detect_overlay_hole(overlay_path: str):
    """
    Detecta automaticamente o "buraco" transparente da moldura lendo o canal alpha.

    Retorna uma tupla (hx, hy, hw, hh, canvas_w, canvas_h) onde:
        (hx, hy)         — canto superior esquerdo da área transparente
        (hw, hh)         — largura e altura da área transparente (onde o vídeo encaixa)
        (canvas_w, h)    — dimensões totais da moldura

    Retorna None se não houver área transparente ou se a detecção falhar
    (ex: Pillow indisponível). O resultado é cacheado por caminho.
    """
    if overlay_path in _overlay_hole_cache:
        return _overlay_hole_cache[overlay_path]

    result = None
    try:
        from PIL import Image
        img = Image.open(overlay_path)
        canvas_w, canvas_h = img.size
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        alpha = img.split()[3]
        # Máscara: 255 onde totalmente transparente (alpha==0), 0 caso contrário.
        # point() e getbbox() são implementados em C (rápidos).
        mask = alpha.point(lambda a: 255 if a == 0 else 0)
        bbox = mask.getbbox()  # (left, upper, right, lower) ou None
        if bbox:
            x, y, right, lower = bbox
            result = (x, y, right - x, lower - y, canvas_w, canvas_h)
            logger.info(
                f"Buraco do overlay detectado em {os.path.basename(overlay_path)}: "
                f"pos=({x},{y}) tam={right - x}x{lower - y} canvas={canvas_w}x{canvas_h}"
            )
        else:
            logger.warning(f"Overlay {overlay_path} não tem área transparente — overlay ignorado.")
    except Exception as e:
        logger.warning(f"Falha ao detectar buraco do overlay {overlay_path}: {e}")

    _overlay_hole_cache[overlay_path] = result
    return result


def _get_media_duration(file_path: str) -> float:
    """Obtém a duração de um arquivo de mídia usando ffprobe."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "json", file_path],
            capture_output=True, text=True, check=True
        )
        data = json.loads(result.stdout)
        return float(data["format"]["duration"])
    except Exception as e:
        logger.error(f"Erro ao obter duração via ffprobe: {e}")
        return 0.0


def _calculate_segments(timeline_events: list, video_duration: float) -> tuple:
    """
    Calcula os segmentos de vídeo e freeze frames.
    Single shared timing rule for both FFmpeg and MoviePy paths.
    
    segments: lista de tuplas:
        ("video", start, end) — segmento de vídeo normal
        ("freeze", freeze_t, duration) — frame congelado
    
    audio_delays: lista de tuplas:
        (audio_path, delay_seconds, audio_duration) — posição do áudio na timeline final
    """
    segments = []
    audio_delays = []
    current_time = 0
    shifted_time = 0

    for event in timeline_events:
        ts = event['timestamp']
        audio_path = event['audio_path']
        dur = event['audio_duration']

        if event.get('is_loading', False):
            # Property 1: keep the recording running; no freeze for loading events.
            run_end = min(current_time + dur, video_duration)
            if run_end > current_time:
                segments.append(("video", current_time, run_end))
            # If the recording ends before the narration, hold the last frame
            # so the narration is fully covered and the timeline stays consistent.
            remainder = dur - (run_end - current_time)
            if remainder > 0:
                hold_t = max(0, video_duration - 0.1)
                segments.append(("freeze", hold_t, remainder))
            # Audio positioned over the running segment
            audio_delays.append((audio_path, shifted_time, dur))
            shifted_time += dur
            current_time = run_end
        else:
            # Property 2: freeze on the click frame (cursor on correct target).
            # clamp(ts, lower=current_time, upper=video_duration - 0.1)
            freeze_ts = max(current_time, min(ts, video_duration - 0.1))

            # 1. Segmento de vídeo normal até o momento do congelamento
            if freeze_ts > current_time:
                end_ts = min(freeze_ts, video_duration)
                segments.append(("video", current_time, end_ts))
                shifted_time += (end_ts - current_time)

            # 2. Frame congelado com duração do áudio TTS
            segments.append(("freeze", freeze_ts, dur))

            # 3. Posição do áudio na timeline expandida
            audio_delays.append((audio_path, shifted_time, dur))

            shifted_time += dur
            current_time = freeze_ts

    # 4. Restante do vídeo após o último evento
    if current_time < video_duration:
        segments.append(("video", current_time, video_duration))

    # 5. Freeze frame final de 3.5 segundos
    if video_duration > 0:
        safe_final_t = max(0, video_duration - 0.1)
        segments.append(("freeze", safe_final_t, 3.5))

    return segments, audio_delays


def _build_filter_complex(segments: list, audio_delays: list, n_audio_inputs: int,
                          overlay_input_idx: int | None = None,
                          overlay_hole: tuple | None = None) -> str:
    """
    Constrói o filter_complex do FFmpeg para composição em passada única.
    
    Usa:
    - trim + setpts para extrair segmentos de vídeo
    - trim + tpad(clone) para criar freeze frames
    - concat para juntar todos os segmentos
    - scale(cover) + crop + pad + overlay para aplicar moldura (se overlay fornecido)
    - adelay + amix para posicionar e mixar áudios TTS

    Estratégia de moldura (cover por altura): o vídeo é escalado para COBRIR o
    buraco preservando o aspecto, centralizado e recortado à dimensão exata do
    buraco. Como o vídeo capturado é mais "largo", isso equivale a escalar pela
    altura e deixar as laterais transbordarem — a moldura opaca por cima esconde
    o excesso. Sem tarja preta e sem distorção.
    """
    filter_chains = []
    seg_labels = []

    for idx, seg in enumerate(segments):
        label = f"seg{idx}"

        if seg[0] == "video":
            start, end = seg[1], seg[2]
            # Extrai segmento de vídeo normal com framerate constante
            filter_chains.append(
                f"[0:v] fps={FPS}, trim=start={start:.4f}:end={end:.4f},"
                f" setpts=PTS-STARTPTS [{label}]"
            )
        else:
            # Freeze frame: extrai ~2 frames e clona até a duração desejada
            freeze_t, duration = seg[1], seg[2]
            frame_end = freeze_t + (FRAME_DUR * 3)  # 3 frames de margem
            filter_chains.append(
                f"[0:v] fps={FPS}, trim=start={freeze_t:.4f}:end={frame_end:.4f},"
                f" setpts=PTS-STARTPTS,"
                f" tpad=stop_mode=clone:stop_duration={duration:.4f},"
                f" trim=duration={duration:.4f},"
                f" setpts=PTS-STARTPTS [{label}]"
            )

        seg_labels.append(f"[{label}]")

    # Concatenar todos os segmentos de vídeo
    n_segs = len(seg_labels)
    concat_input = "".join(seg_labels)
    filter_chains.append(
        f"{concat_input} concat=n={n_segs}:v=1:a=0 [vconcat]"
    )

    # Aplicar moldura (overlay) se configurado
    if overlay_input_idx is not None and overlay_hole is not None:
        hx, hy, hw, hh, cw, ch = overlay_hole
        # 1. Escalar o vídeo pela altura do buraco (preserva aspecto)
        filter_chains.append(
            f"[vconcat] scale=-2:{hh},setsar=1,setpts=PTS-STARTPTS [vscaled]"
        )
        # 2. Moldura como BASE, vídeo posicionado POR CIMA centralizado no buraco
        #    x = hx + (hw - video_w) / 2  →  usa expressão nativa do FFmpeg
        filter_chains.append(
            f"[{overlay_input_idx}:v] format=rgba [ovr]"
        )
        filter_chains.append(
            f"[ovr][vscaled] overlay={hx}+(({hw}-overlay_w)/2):{hy}:format=auto [vout]"
        )
    else:
        # Sem overlay — renomeia vconcat para vout
        filter_chains.append(
            f"[vconcat] null [vout]"
        )

    # Processar áudios TTS (posicionar cada um no timestamp correto)
    if audio_delays:
        audio_labels = []
        for idx, (audio_path, delay_sec, audio_dur) in enumerate(audio_delays):
            audio_input_idx = idx + 1  # input[0] é o vídeo
            delay_ms = int(delay_sec * 1000)
            label = f"a{idx}"
            # adelay posiciona o áudio no momento correto da timeline final
            filter_chains.append(
                f"[{audio_input_idx}:a] adelay={delay_ms}|{delay_ms} [{label}]"
            )
            audio_labels.append(f"[{label}]")

        # Mixar todos os áudios (sem normalização para preservar volume)
        n_audio = len(audio_labels)
        audio_input_str = "".join(audio_labels)
        if n_audio == 1:
            # Com apenas 1 áudio, amix não é necessário — renomeia para [aout]
            filter_chains.append(
                f"{audio_input_str} anull [aout]"
            )
        else:
            filter_chains.append(
                f"{audio_input_str} amix=inputs={n_audio}:duration=longest:normalize=0 [aout]"
            )

    return ";\n".join(filter_chains)


def compose_video_with_freeze_frames(input_webm: str, output_mp4: str, timeline_events: list,
                                     overlay_path: str | None = DEFAULT_OVERLAY):
    """
    Compõe vídeo final com freeze frames e narração TTS.
    
    Pipeline otimizada: FFmpeg puro com filter_complex (passada única).
    Fallback: MoviePy (código legado) se o FFmpeg falhar.
    
    Args:
        input_webm: Caminho do vídeo de entrada (.webm)
        output_mp4: Caminho do vídeo de saída (.mp4)
        timeline_events: Lista de eventos com timestamp e audio_path
        overlay_path: Caminho do PNG da moldura (None para desativar)
    
    timeline_events = [
        {"timestamp": 2.5, "audio_path": "audios/passo_1.mp3"},
        {"timestamp": 5.0, "audio_path": "audios/passo_2.mp3"}
    ]
    """
    if not os.path.exists(input_webm):
        logger.error("Vídeo de entrada não encontrado.")
        return False

    # Sem eventos: apenas converte formato
    if not timeline_events:
        return _simple_convert(input_webm, output_mp4)

    # Obter duração do vídeo
    video_duration = _get_media_duration(input_webm)
    if video_duration <= 0:
        logger.error("Não foi possível determinar a duração do vídeo.")
        return False

    # Validar e obter duração de cada áudio
    valid_events = []
    for event in timeline_events:
        audio_path = event['audio_path']
        if not os.path.exists(audio_path):
            logger.warning(f"Áudio não encontrado: {audio_path}")
            continue
        dur = _get_media_duration(audio_path)
        if dur > 0:
            valid_events.append({
                "timestamp": event["timestamp"],
                "audio_path": audio_path,
                "audio_duration": dur,
                "is_loading": bool(event.get("is_loading", False))
            })

    if not valid_events:
        logger.warning("Nenhum áudio válido encontrado. Convertendo sem narração.")
        return _simple_convert(input_webm, output_mp4)

    # Calcular segmentos e posições de áudio
    segments, audio_delays = _calculate_segments(valid_events, video_duration)

    if not segments:
        logger.error("Nenhum segmento gerado na timeline.")
        return False

    # Construir filter_complex
    # Determinar se overlay está ativo e detectar a geometria do buraco
    use_overlay = bool(overlay_path and os.path.exists(overlay_path))
    overlay_hole = _detect_overlay_hole(overlay_path) if use_overlay else None
    # Se a detecção falhar (sem área transparente / Pillow ausente), desativa o overlay
    if use_overlay and overlay_hole is None:
        use_overlay = False
    overlay_input_idx = None

    # Montar inputs FFmpeg: vídeo + todos os áudios + overlay (se houver)
    inputs = ["-i", input_webm]
    for event in valid_events:
        inputs.extend(["-i", event["audio_path"]])

    if use_overlay:
        inputs.extend(["-i", overlay_path])
        overlay_input_idx = 1 + len(valid_events)  # último input

    filter_complex = _build_filter_complex(segments, audio_delays, len(valid_events),
                                           overlay_input_idx=overlay_input_idx,
                                           overlay_hole=overlay_hole)

    # Determinar mapeamento de áudio
    has_audio = len(audio_delays) > 0
    audio_map_label = "[aout]" if has_audio else None

    # Construir comando FFmpeg completo
    cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", filter_complex,
        "-map", "[vout]",
    ]

    if audio_map_label:
        cmd.extend(["-map", audio_map_label])

    cmd.extend([
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_mp4
    ])

    # Executar FFmpeg
    try:
        logger.info(f"Renderizando MP4 via FFmpeg puro: {output_mp4}")
        print("Iniciando renderização FFmpeg (passada única)...")
        print(f"  Segmentos de vídeo: {len(segments)}")
        print(f"  Faixas de áudio: {len(audio_delays)}")
        if use_overlay:
            print(f"  Overlay: {os.path.basename(overlay_path)}")

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            logger.error(f"FFmpeg retornou código {result.returncode}")
            logger.error(f"FFmpeg stderr: {result.stderr[-2000:]}")
            print("[AVISO] FFmpeg filter_complex falhou. Tentando fallback MoviePy...")
            return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events, overlay_path)

        # Verificar se o arquivo foi criado
        if not os.path.exists(output_mp4) or os.path.getsize(output_mp4) < 1000:
            logger.error("Arquivo de saída não foi gerado corretamente.")
            print("[AVISO] Saída inválida. Tentando fallback MoviePy...")
            return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events, overlay_path)

        output_size_mb = os.path.getsize(output_mp4) / (1024 * 1024)
        print(f"[OK] Renderização concluída! ({output_size_mb:.1f} MB)")
        logger.info(f"Renderização FFmpeg concluída: {output_mp4} ({output_size_mb:.1f} MB)")
        return True

    except subprocess.TimeoutExpired:
        logger.error("FFmpeg excedeu o timeout de 600 segundos.")
        print("[AVISO] Timeout FFmpeg. Tentando fallback MoviePy...")
        return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events, overlay_path)

    except Exception as e:
        logger.error(f"Erro na execução do FFmpeg: {e}")
        print(f"[AVISO] Erro FFmpeg: {e}. Tentando fallback MoviePy...")
        return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events, overlay_path)


def _simple_convert(input_webm: str, output_mp4: str) -> bool:
    """Conversão simples WebM→MP4 sem freeze frames."""
    try:
        print("Convertendo WebM -> MP4 (sem freeze frames)...")
        subprocess.run([
            "ffmpeg", "-y", "-i", input_webm,
            "-r", str(FPS), "-c:v", "libx264", "-preset", "fast",
            "-crf", "23", "-c:a", "aac", "-b:a", "128k",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            output_mp4
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception as e:
        logger.error(f"Erro na conversão simples: {e}")
        return False


def _compose_legacy_moviepy(input_webm: str, output_mp4: str, timeline_events: list,
                            overlay_path: str | None = DEFAULT_OVERLAY):
    """
    Fallback: composição via MoviePy.
    Usado automaticamente se o pipeline FFmpeg puro falhar.

    Delegates timing to the shared _calculate_segments rule so that both
    the FFmpeg path and this fallback produce identical (segments, audio_delays).
    """
    try:
        from moviepy import (VideoFileClip, AudioFileClip, CompositeAudioClip,
                             CompositeVideoClip, ImageClip, concatenate_videoclips)
    except ImportError:
        logger.error("MoviePy não instalado. Não é possível usar fallback.")
        return False

    # Passo 1: VFR → CFR (com CRF 28 para intermediário — será re-encodado)
    cfr_mp4 = input_webm.replace(".webm", "_cfr.mp4")
    try:
        print("[Fallback MoviePy] Convertendo VFR -> CFR...")
        subprocess.run([
            "ffmpeg", "-y", "-i", input_webm,
            "-r", "30", "-c:v", "libx264", "-preset", "ultrafast",
            "-crf", "28", cfr_mp4
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        input_file = cfr_mp4
    except Exception as e:
        logger.error(f"Falha na conversão CFR com FFmpeg (usando original): {e}")
        input_file = input_webm

    try:
        print("[Fallback MoviePy] Abrindo video clip...")
        video = VideoFileClip(input_file)
        print(f"[Fallback MoviePy] Video aberto com duracao {video.duration}")

        # Build valid_events exactly as the FFmpeg path does:
        # skip missing audio files, compute each audio_duration, carry is_loading.
        valid_events = []
        for event in timeline_events:
            audio_path = event['audio_path']
            if not os.path.exists(audio_path):
                logger.warning(f"Audio não encontrado: {audio_path}")
                continue
            dur = _get_media_duration(audio_path)
            if dur > 0:
                valid_events.append({
                    "timestamp": event["timestamp"],
                    "audio_path": audio_path,
                    "audio_duration": dur,
                    "is_loading": bool(event.get("is_loading", False)),
                })

        if not valid_events:
            logger.warning("Nenhum áudio válido encontrado no fallback MoviePy.")
            video.close()
            try:
                if input_file != input_webm and os.path.exists(input_file):
                    os.remove(input_file)
            except:
                pass
            return _simple_convert(input_webm, output_mp4)

        # Derive timing from the single shared rule (Property 3).
        segments, audio_delays = _calculate_segments(valid_events, video.duration)

        if not segments:
            logger.error("Nenhum segmento gerado na timeline.")
            video.close()
            return False

        # Render from the shared plan using MoviePy APIs.
        clips = []
        for seg in segments:
            if seg[0] == "video":
                start, end = seg[1], seg[2]
                clip = video.subclipped(start, end)
                clips.append(clip)
            else:
                # ("freeze", freeze_t, duration)
                freeze_t, duration = seg[1], seg[2]
                print(f"[Fallback MoviePy] Gerando frame congelado no tempo {freeze_t}")
                freeze = video.to_ImageClip(t=freeze_t).with_duration(duration)
                clips.append(freeze)
                print("[Fallback MoviePy] Frame congelado adicionado")

        # Place each audio with the delay from the shared plan.
        audio_clips = []
        for audio_path, delay, _dur in audio_delays:
            audio = AudioFileClip(audio_path).with_start(delay)
            audio_clips.append(audio)

        # Concatena e aplica a trilha de voz
        if not clips:
            logger.error("Nenhum clip gerado na timeline.")
            return False

        final_video = concatenate_videoclips(clips)

        # Aplicar moldura (overlay) se configurado
        use_overlay = bool(overlay_path and os.path.exists(overlay_path))
        overlay_hole = _detect_overlay_hole(overlay_path) if use_overlay else None
        if use_overlay and overlay_hole is not None:
            hx, hy, hw, hh, cw, ch = overlay_hole
            print(f"[Fallback MoviePy] Aplicando overlay: {os.path.basename(overlay_path)}")
            overlay_clip = ImageClip(overlay_path).with_duration(final_video.duration)
            # Escalar pela altura do buraco preservando aspecto
            scale = hh / final_video.h
            scaled = final_video.resized(scale)
            # Centralizar horizontalmente no canvas, posicionar no topo do buraco
            pos_x = (cw - scaled.w) / 2
            pos_y = hy
            final_video = CompositeVideoClip([
                overlay_clip,                         # moldura como base
                scaled.with_position((pos_x, pos_y))  # vídeo por cima
            ], size=(cw, ch))

        if audio_clips:
            final_video = final_video.with_audio(CompositeAudioClip(audio_clips))

        # Renderiza
        logger.info(f"[Fallback MoviePy] Renderizando MP4 final: {output_mp4}")
        print("[Fallback MoviePy] Iniciando write_videofile...")
        final_video.write_videofile(
            output_mp4,
            codec="libx264",
            audio_codec="aac",
            fps=30,
            preset="fast",
            threads=4,
            ffmpeg_params=["-crf", "23", "-pix_fmt", "yuv420p"]
        )

        video.close()
        final_video.close()
        for a in audio_clips:
            a.close()

        try:
            if input_file != input_webm and os.path.exists(input_file):
                os.remove(input_file)
        except:
            pass

        return True
    except Exception as e:
        logger.error(f"[Fallback MoviePy] Erro na composição do vídeo: {e}")
        try:
            if 'input_file' in locals() and input_file != input_webm and os.path.exists(input_file):
                os.remove(input_file)
        except:
            pass
        return False
