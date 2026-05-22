import os
import logging
from moviepy import VideoFileClip, AudioFileClip, CompositeAudioClip, concatenate_videoclips

logger = logging.getLogger(__name__)

def compose_video_with_freeze_frames(input_webm: str, output_mp4: str, timeline_events: list):
    """
    timeline_events = [
        {"timestamp": 2.5, "audio_path": "audios/passo_1.mp3"},
        {"timestamp": 5.0, "audio_path": "audios/passo_2.mp3"}
    ]
    """
    if not os.path.exists(input_webm):
        logger.error("Vídeo de entrada não encontrado.")
        return False

    try:
        print("Abrindo video clip...")
        video = VideoFileClip(input_webm)
        print(f"Video aberto com duracao {video.duration}")
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
            # Volta 0.8 segundos no tempo (ou trava no zero se for no inicio).
            freeze_ts = max(0, ts - 0.8)
            
            # 1. Adiciona o vídeo normal do ponto atual até o momento do congelamento
            if freeze_ts > current_time:
                end_ts = min(freeze_ts, video.duration)
                clip = video.subclipped(current_time, end_ts)
                clips.append(clip)
                shifted_time += clip.duration
                
            # 2. Extrai o frame exato 0.8s antes do clique e congela
            # Aqui a IA vai falar "Clique no botão X" enquanto a tela está estática
            safe_freeze = min(freeze_ts, video.duration - 0.1)
            print(f"Gerando frame congelado no tempo {safe_freeze}")
            freeze = video.to_ImageClip(t=safe_freeze).with_duration(dur)
            clips.append(freeze)
            print("Frame congelado adicionado")
            
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
        logger.info(f"Renderizando MP4 final: {output_mp4}")
        print("Iniciando write_videofile...")
        final_video.write_videofile(
            output_mp4,
            codec="libx264",
            audio_codec="aac",
            fps=30,
            preset="fast",
            threads=4,
            ffmpeg_params=["-crf", "18", "-pix_fmt", "yuv420p"]
        )
        
        video.close()
        final_video.close()
        for a in audio_clips:
            a.close()
            
        return True
    except Exception as e:
        logger.error(f"Erro na composição do vídeo (Time Bender): {e}")
        return False
