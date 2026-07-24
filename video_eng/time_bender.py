import os
import logging
import subprocess
import json
import shutil
import concurrent.futures
import tempfile
import uuid

# Verifica a disponibilidade do ffmpeg e ffprobe na PATH do sistema
_ffmpeg_path = shutil.which("ffmpeg")
_ffprobe_path = shutil.which("ffprobe")

FFMPEG_CMD = _ffmpeg_path if _ffmpeg_path else "ffmpeg"
FFPROBE_CMD = _ffprobe_path if _ffprobe_path else "ffprobe"

if not _ffmpeg_path or not _ffprobe_path:
    logging.getLogger("uvicorn.error").warning(
        "FFmpeg ou FFprobe NÃO encontrados no PATH do sistema. "
        "Certifique-se de que estão instalados e configurados no PATH."
    )

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
            [FFPROBE_CMD, "-v", "quiet", "-show_entries", "format=duration",
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
    """
    segments = []
    audio_delays = []
    
    first_ts = timeline_events[0]['timestamp'] if timeline_events else 0.0
    start_offset = max(0.0, min(0.5, first_ts - 0.2))
    
    current_time = start_offset
    shifted_time = 0

    for event in timeline_events:
        ts = event['timestamp']
        audio_path = event['audio_path']
        dur = event['audio_duration']

        if event.get('is_outro', False) or event.get('is_loading', False):
            # Para a Conclusão (Outro): o vídeo corre solto aproveitando o restante da gravação
            run_end = min(current_time + dur, video_duration)
            if run_end > current_time + 0.001:
                segments.append(("video", current_time, run_end))
            # Se a gravação acabar antes do término da narração, segura o último frame
            remainder = dur - (run_end - current_time)
            if remainder > 0.001:
                hold_t = max(0, video_duration - 0.1)
                segments.append(("freeze", hold_t, remainder))
            audio_delays.append((audio_path, shifted_time, dur))
            shifted_time += dur
            current_time = run_end
        else:
            # Passos normais (cliques): vídeo anda até o clique e CONGELA no alvo enquanto narra
            freeze_ts = max(current_time, min(ts, video_duration - 0.1))

            # 1. Segmento de vídeo normal até o momento do congelamento
            if freeze_ts > current_time + 0.001:
                end_ts = min(freeze_ts, video_duration)
                segments.append(("video", current_time, end_ts))
                shifted_time += (end_ts - current_time)

            # 2. Frame congelado no alvo com a duração da narração do passo
            segments.append(("freeze", freeze_ts, dur))

            # 3. Posição do áudio na timeline expandida
            audio_delays.append((audio_path, shifted_time, dur))

            shifted_time += dur
            current_time = freeze_ts

    # 4. Restante do vídeo após o último evento
    if current_time < video_duration - 0.001:
        segments.append(("video", current_time, video_duration))

    # 5. Freeze frame final de 3.5 segundos
    if video_duration > 0:
        safe_final_t = max(0, video_duration - 0.1)
        segments.append(("freeze", safe_final_t, 3.5))

    return segments, audio_delays





def _build_filter_complex(audio_delays: list, n_audio_inputs: int,
                          n_video_segments: int,
                          audio_start_idx: int,
                          overlay_input_idx: int | None = None,
                          overlay_hole: tuple | None = None) -> str:
    filter_chains = []

    # 1. Concatenar todos os chunks de video físicos
    concat_inputs = "".join([f"[{i}:v]" for i in range(n_video_segments)])
    filter_chains.append(
        f"{concat_inputs}concat=n={n_video_segments}:v=1:a=0[vcat]"
    )

    # 2. Aplicar moldura (overlay) se configurado
    if overlay_input_idx is not None and overlay_hole is not None:
        hx, hy, hw, hh, cw, ch = overlay_hole
        filter_chains.append(
            f"[vcat] scale=-2:{hh},setsar=1,setpts=N/({FPS}*TB) [vscaled]"
        )
        filter_chains.append(
            f"[{overlay_input_idx}:v] format=rgba [ovr]"
        )
        filter_chains.append(
            f"[ovr][vscaled] overlay={hx}+(({hw}-overlay_w)/2):{hy}:format=auto [vout]"
        )
    else:
        filter_chains.append(
            f"[vcat] setpts=N/({FPS}*TB) [vout]"
        )

    # 3. Processar áudios TTS
    audio_labels = []
    if audio_delays:
        for i, (path, shift, dur) in enumerate(audio_delays):
            idx = audio_start_idx + i
            delay_ms = int(shift * 1000)
            filter_chains.append(
                f"[{idx}:a] adelay={delay_ms}|{delay_ms} [a{i}]"
            )
            audio_labels.append(f"[a{i}]")

        n_audio = len(audio_labels)
        audio_input_str = "".join(audio_labels)
        if n_audio == 1:
            filter_chains.append(
                f"{audio_input_str} anull [aout]"
            )
        else:
            filter_chains.append(
                f"{audio_input_str} amix=inputs={n_audio}:duration=longest:normalize=0 [aout]"
            )

    return ";\n".join(filter_chains)




def _generate_dummy_chunk(idx, duration, tmp_dir, process_input):
    chunk_path = os.path.join(tmp_dir, f"seg_{idx}_dummy.mp4").replace('\\', '/')
    frame_png_path = os.path.join(tmp_dir, f"dummy_frame_{idx}.png")
    
    subprocess.run([
        FFMPEG_CMD, "-y", "-i", process_input, "-ss", "0.1",
        "-frames:v", "1", "-q:v", "2", frame_png_path
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    if not os.path.exists(frame_png_path):
        subprocess.run([
            FFMPEG_CMD, "-y", "-f", "lavfi", "-i", f"color=c=black:s=1920x1080:r={FPS}",
            "-t", str(duration), "-c:v", "libx264", "-preset", "ultrafast",
            "-g", "1", "-keyint_min", "1", "-crf", "18", "-pix_fmt", "yuv420p", "-an", chunk_path
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return chunk_path
        
    subprocess.run([
        FFMPEG_CMD, "-y", "-loop", "1", "-framerate", str(FPS), "-i", frame_png_path,
        "-t", str(duration), "-c:v", "libx264", "-preset", "ultrafast",
        "-g", "1", "-keyint_min", "1", "-crf", "18", "-pix_fmt", "yuv420p", "-an", chunk_path
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return chunk_path

def _generate_video_chunk(idx, start, end, process_input, tmp_dir):
    chunk_path = os.path.join(tmp_dir, f"seg_{idx}.mp4").replace('\\', '/')
    subprocess.run([
        FFMPEG_CMD, "-y", "-ss", str(start), "-to", str(end),
        "-i", process_input, "-c", "copy", chunk_path
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return idx, chunk_path

def _generate_freeze_clip(idx, freeze_ts, duration, process_input, tmp_dir):
    chunk_path = os.path.join(tmp_dir, f"seg_{idx}.mp4").replace('\\', '/')
    frame_png_path = os.path.join(tmp_dir, f"frame_{idx}.png")
    
    extract_ts = 0.2 if freeze_ts == 0.0 else freeze_ts
    
    subprocess.run([
        FFMPEG_CMD, "-y", "-i", process_input, "-ss", str(extract_ts),
        "-frames:v", "1", "-q:v", "2", frame_png_path
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    if not os.path.exists(frame_png_path):
        fallback_ts = max(0.0, freeze_ts - 0.5)
        subprocess.run([
            FFMPEG_CMD, "-y", "-i", process_input, "-ss", str(fallback_ts),
            "-frames:v", "1", "-q:v", "2", frame_png_path
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
    subprocess.run([
        FFMPEG_CMD, "-y", "-loop", "1", "-framerate", str(FPS), "-i", frame_png_path,
        "-t", str(duration), "-c:v", "libx264", "-preset", "ultrafast",
        "-g", "1", "-keyint_min", "1", "-crf", "18", "-pix_fmt", "yuv420p", "-an", chunk_path
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    return idx, chunk_path






def compose_video_with_freeze_frames(input_webm: str, output_mp4: str, timeline_events: list,
                                     overlay_path: str | None = DEFAULT_OVERLAY):
    if not os.path.exists(input_webm):
        logger.error("Vídeo de entrada não encontrado.")
        return False

    if not timeline_events:
        return _simple_convert(input_webm, output_mp4)

    cfr_mp4 = input_webm.replace(".webm", "_cfr.mp4")
    try:
        print("Pré-convertendo WebM VFR para CFR silencioso...")
        subprocess.run([
            FFMPEG_CMD, "-y", "-i", input_webm,
            "-vf", f"fps={FPS}", "-c:v", "libx264", "-preset", "ultrafast",
            "-g", "1", "-keyint_min", "1", "-crf", "20", "-pix_fmt", "yuv420p", "-an", cfr_mp4
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        process_input = cfr_mp4
    except Exception as e:
        logger.error(f"Falha na conversão inicial para CFR: {e}")
        process_input = input_webm

    video_duration = _get_media_duration(process_input)
    if video_duration <= 0:
        logger.error("Não foi possível determinar a duração do vídeo.")
        return False

    valid_events = []
    for event in timeline_events:
        audio_path = event['audio_path']
        if not os.path.exists(audio_path):
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
        return _simple_convert(input_webm, output_mp4)

    segments, audio_delays = _calculate_segments(valid_events, video_duration)
    if not segments:
        return False

    tmp_dir = os.path.join(os.path.dirname(process_input), f"tmp_{uuid.uuid4().hex[:8]}")
    os.makedirs(tmp_dir, exist_ok=True)
    
    try:
        print("Gerando chunks físicos O(1) memoria...")
        seg_results = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = []
            for idx, seg in enumerate(segments):
                if seg[0] == "freeze":
                    futures.append(executor.submit(_generate_freeze_clip, idx, seg[1], seg[2], process_input, tmp_dir))
                else:
                    futures.append(executor.submit(_generate_video_chunk, idx, seg[1], seg[2], process_input, tmp_dir))
                    
            for future in concurrent.futures.as_completed(futures):
                idx, path = future.result()
                seg_results[idx] = path

        inputs = []
        n_video_segments = len(segments)
        for idx in range(n_video_segments):
            path = seg_results.get(idx)
            if not path or not os.path.exists(path) or os.path.getsize(path) < 100:
                print(f"[AVISO] Segmento {idx} falhou ou vazio. Gerando fallback preto...")
                seg = segments[idx]
                dur = seg[2] if seg[0] == "freeze" else (seg[2] - seg[1])
                path = _generate_dummy_chunk(idx, max(0.1, dur), tmp_dir, process_input)
            abs_path = os.path.abspath(path).replace('\\', '/')
            inputs.extend(["-i", abs_path])
        
        audio_start_idx = n_video_segments
        for event in valid_events:
            inputs.extend(["-i", event["audio_path"]])

        use_overlay = bool(overlay_path and os.path.exists(overlay_path))
        overlay_hole = _detect_overlay_hole(overlay_path) if use_overlay else None
        if use_overlay and overlay_hole is None:
            use_overlay = False

        if use_overlay:
            inputs.extend(["-i", overlay_path])
            overlay_input_idx = n_video_segments + len(valid_events)
        else:
            overlay_input_idx = None

        filter_complex = _build_filter_complex(audio_delays, len(valid_events),
                                               n_video_segments=n_video_segments,
                                               audio_start_idx=audio_start_idx,
                                               overlay_input_idx=overlay_input_idx,
                                               overlay_hole=overlay_hole)

        has_audio = len(audio_delays) > 0
        audio_map_label = "[aout]" if has_audio else None

        cmd = [FFMPEG_CMD, "-y"] + inputs + [
            "-filter_complex", filter_complex,
            "-map", "[vout]",
        ]

        if audio_map_label:
            cmd.extend(["-map", audio_map_label])

        cmd.extend([
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "18",
            "-c:a", "aac",
            "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            output_mp4
        ])

        logger.info(f"Renderizando MP4 via FFmpeg Filter Concat: {output_mp4}")
        print("Iniciando renderização FFmpeg (Filter Concat com múltiplos inputs)...")

        result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore', timeout=600)

        # Cleanup
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except:
            pass

        if result.returncode != 0:
            logger.error(f"FFmpeg retornou código {result.returncode}")
            stderr_text = result.stderr[-2000:] if result.stderr else "Nenhum erro detalhado disponível."
            logger.error(f"FFmpeg stderr: {stderr_text}")
            print("[AVISO] FFmpeg falhou. Tentando fallback MoviePy...")
            return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events, overlay_path)

        if not os.path.exists(output_mp4) or os.path.getsize(output_mp4) < 1000:
            logger.error("Arquivo de saída não foi gerado corretamente.")
            return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events, overlay_path)

        output_size_mb = os.path.getsize(output_mp4) / (1024 * 1024)
        print(f"[OK] Renderização concluída! ({output_size_mb:.1f} MB)")
        logger.info(f"Renderização FFmpeg concluída: {output_mp4} ({output_size_mb:.1f} MB)")
        return True

    except subprocess.TimeoutExpired:
        logger.error("FFmpeg excedeu o timeout de 600 segundos.")
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except:
            pass
        return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events, overlay_path)

    except Exception as e:
        logger.error(f"Erro na execução do FFmpeg: {e}")
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except:
            pass
        return _compose_legacy_moviepy(input_webm, output_mp4, timeline_events, overlay_path)

def _simple_convert(input_webm: str, output_mp4: str) -> bool:
    """Conversão simples WebM→MP4 sem freeze frames."""
    try:
        print("Convertendo WebM -> MP4 (sem freeze frames)...")
        subprocess.run([
            FFMPEG_CMD, "-y", "-i", input_webm,
            "-r", str(FPS), "-c:v", "libx264", "-preset", "fast",
            "-crf", "18", "-c:a", "aac", "-b:a", "128k",
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
            FFMPEG_CMD, "-y", "-i", input_webm,
            "-r", "30", "-c:v", "libx264", "-preset", "ultrafast",
            "-crf", "20", cfr_mp4
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
