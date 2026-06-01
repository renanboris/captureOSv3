import os
import logging
import subprocess
import json
import shutil
import static_ffmpeg

# Instala e injeta o FFmpeg/FFprobe no PATH do Windows dinamicamente
static_ffmpeg.add_paths()

logger = logging.getLogger(__name__)

FPS = 30
FRAME_DUR = 1.0 / FPS


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
    Retorna (segments, audio_delays) com a mesma lógica do código original.
    
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
        audio_dur = event['audio_duration']

        # Lógica original preservada: congela 0.2s ANTES do clique
        safe_offset = 0.2
        if current_time > 0:
            freeze_ts = max(current_time + 0.1, ts - safe_offset)
            if freeze_ts >= ts:
                freeze_ts = max(current_time, ts - 0.1)
        else:
            freeze_ts = max(0, ts - safe_offset)

        # 1. Segmento de vídeo normal até o momento do congelamento
        if freeze_ts > current_time:
            end_ts = min(freeze_ts, video_duration)
            seg_dur = end_ts - current_time
            segments.append(("video", current_time, end_ts))
            shifted_time += seg_dur

        # 2. Frame congelado com duração do áudio TTS
        safe_freeze = min(freeze_ts, video_duration - 0.1)
        segments.append(("freeze", safe_freeze, audio_dur))

        # 3. Posição do áudio na timeline expandida
        audio_delays.append((audio_path, shifted_time, audio_dur))

        shifted_time += audio_dur
        current_time = freeze_ts

    # 4. Restante do vídeo após o último evento
    if current_time < video_duration:
        segments.append(("video", current_time, video_duration))

    # 5. Freeze frame final de 3.5 segundos
    if video_duration > 0:
        safe_final_t = max(0, video_duration - 0.1)
        segments.append(("freeze", safe_final_t, 3.5))

    return segments, audio_delays


def _build_filter_complex(segments: list, audio_delays: list, n_audio_inputs: int) -> str:
    """
    Constrói o filter_complex do FFmpeg para composição em passada única.
    
    Usa:
    - trim + setpts para extrair segmentos de vídeo
    - trim + tpad(clone) para criar freeze frames
    - concat para juntar todos os segmentos
    - adelay + amix para posicionar e mixar áudios TTS
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
        f"{concat_input} concat=n={n_segs}:v=1:a=0 [vout]"
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


def compose_video_with_freeze_frames(input_webm: str, output_mp4: str, timeline_events: list):
    """
    Compõe vídeo final com freeze frames e narração TTS.
    
    Pipeline otimizada: FFmpeg puro com filter_complex (passada única).
    Fallback: MoviePy (código legado) se o FFmpeg falhar.
    
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
                "audio_duration": dur
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
    filter_complex = _build_filter_complex(segments, audio_delays, len(valid_events))

    # Montar inputs FFmpeg: vídeo + todos os áudios
    inputs = ["-i", input_webm]
    for event in valid_events:
        inputs.extend(["-i", event["audio_path"]])

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

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            logger.error(f"FFmpeg retornou código {result.returncode}")
            logger.error(f"FFmpeg stderr: {result.stderr[-2000:]}")
            print("[AVISO] FFmpeg filter_complex falhou. Tentando fallback MoviePy...")
            return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events)

        # Verificar se o arquivo foi criado
        if not os.path.exists(output_mp4) or os.path.getsize(output_mp4) < 1000:
            logger.error("Arquivo de saída não foi gerado corretamente.")
            print("[AVISO] Saída inválida. Tentando fallback MoviePy...")
            return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events)

        output_size_mb = os.path.getsize(output_mp4) / (1024 * 1024)
        print(f"[OK] Renderização concluída! ({output_size_mb:.1f} MB)")
        logger.info(f"Renderização FFmpeg concluída: {output_mp4} ({output_size_mb:.1f} MB)")
        return True

    except subprocess.TimeoutExpired:
        logger.error("FFmpeg excedeu o timeout de 600 segundos.")
        print("[AVISO] Timeout FFmpeg. Tentando fallback MoviePy...")
        return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events)

    except Exception as e:
        logger.error(f"Erro na execução do FFmpeg: {e}")
        print(f"[AVISO] Erro FFmpeg: {e}. Tentando fallback MoviePy...")
        return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events)


def _simple_convert(input_webm: str, output_mp4: str) -> bool:
    """Conversão simples WebM→MP4 sem freeze frames."""
    try:
        print("Convertendo WebM → MP4 (sem freeze frames)...")
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


def _compose_legacy_moviepy(input_webm: str, output_mp4: str, timeline_events: list):
    """
    Fallback: composição via MoviePy (código legado).
    Usado automaticamente se o pipeline FFmpeg puro falhar.
    """
    try:
        from moviepy import VideoFileClip, AudioFileClip, CompositeAudioClip, concatenate_videoclips
    except ImportError:
        logger.error("MoviePy não instalado. Não é possível usar fallback.")
        return False

    # Passo 1: VFR → CFR (com CRF 28 para intermediário — será re-encodado)
    cfr_mp4 = input_webm.replace(".webm", "_cfr.mp4")
    try:
        print("[Fallback MoviePy] Convertendo VFR → CFR...")
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
        clips = []
        audio_clips = []

        current_time = 0
        shifted_time = 0

        for event in timeline_events:
            ts = event['timestamp']
            audio_path = event['audio_path']

            if not os.path.exists(audio_path):
                logger.warning(f"Audio não encontrado: {audio_path}")
                continue

            audio = AudioFileClip(audio_path)
            dur = audio.duration

            # O Segredo Pedagógico: Congelar a tela ANTES do clique acontecer!
            # Volta apenas 0.2 segundos (evita pegar o clique em si), e garante que
            # nunca volte para o passado antes do último evento (evitando flicker/piscar).
            safe_offset = 0.2
            if current_time > 0:
                freeze_ts = max(current_time + 0.1, ts - safe_offset)
                if freeze_ts >= ts:
                    freeze_ts = max(current_time, ts - 0.1) # Fallback muito rápido
            else:
                freeze_ts = max(0, ts - safe_offset)

            # 1. Adiciona o vídeo normal do ponto atual até o momento do congelamento
            if freeze_ts > current_time:
                end_ts = min(freeze_ts, video.duration)
                clip = video.subclipped(current_time, end_ts)
                clips.append(clip)
                shifted_time += clip.duration

            # 2. Extrai o frame exato antes do clique e congela
            # Aqui a IA vai falar enquanto a tela está estática
            safe_freeze = min(freeze_ts, video.duration - 0.1)
            print(f"[Fallback MoviePy] Gerando frame congelado no tempo {safe_freeze}")
            freeze = video.to_ImageClip(t=safe_freeze).with_duration(dur)
            clips.append(freeze)
            print("[Fallback MoviePy] Frame congelado adicionado")

            # 3. Posiciona o áudio exatamente no momento do freeze frame
            audio = audio.with_start(shifted_time)
            audio_clips.append(audio)

            # Atualiza os contadores
            shifted_time += dur
            current_time = freeze_ts

        # 4. Adiciona o restante do vídeo (após o último clique)
        if current_time < video.duration:
            clip = video.subclipped(current_time, video.duration)
            clips.append(clip)

        # Adiciona um freeze frame final de 3.5 segundos para mostrar o resultado da última ação
        if video.duration > 0:
            safe_final_t = max(0, video.duration - 0.1)
            final_freeze = video.to_ImageClip(t=safe_final_t).with_duration(3.5)
            clips.append(final_freeze)

        # 5. Concatena e aplica a trilha de voz
        if not clips:
            logger.error("Nenhum clip gerado na timeline.")
            return False

        final_video = concatenate_videoclips(clips)

        if audio_clips:
            final_video = final_video.with_audio(CompositeAudioClip(audio_clips))

        # 6. Renderiza
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
