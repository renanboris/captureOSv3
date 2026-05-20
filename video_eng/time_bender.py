import os
import logging
try:
    import ffmpeg
except ImportError:
    ffmpeg = None

logger = logging.getLogger(__name__)

def inject_freeze_frame(input_webm: str, click_timestamp_sec: float, freeze_duration_sec: float, output_webm: str):
    """
    Corta o vídeo no instante do clique, injeta uma repetição estática (freeze frame) 
    para expandir a duração e caber o TTS da Aura, e concatena o restante do vídeo.
    """
    if not ffmpeg:
        logger.error("ffmpeg-python não instalado. Rode: pip install ffmpeg-python")
        return False

    if not os.path.exists(input_webm):
        logger.error(f"Vídeo de entrada não encontrado: {input_webm}")
        return False
        
    try:
        # Puxando o input principal
        in_file = ffmpeg.input(input_webm)
        
        # Corta a Parte 1 (do começo até o clique)
        part1 = in_file.trim(start=0, end=click_timestamp_sec).setpts('PTS-STARTPTS')
        
        # Extrai o frame exato do clique para congelar
        freeze = (
            in_file
            .trim(start=click_timestamp_sec, end=click_timestamp_sec + 0.05) # Pega um frame minimo
            .filter('loop', loop=-1, size=1) # Faz o frame se repetir infinitamente
            .trim(duration=freeze_duration_sec) # Limita a duração da repetição ao tempo do áudio TTS
            .setpts('PTS-STARTPTS')
        )
        
        # Corta a Parte 2 (do clique até o fim)
        part2 = in_file.trim(start=click_timestamp_sec).setpts('PTS-STARTPTS')
        
        # Concatena as 3 partes
        joined = ffmpeg.concat(part1, freeze, part2, v=1, a=0)
        
        # Gera o output
        joined.output(output_webm).run(overwrite_output=True, quiet=True)
        
        logger.info(f"Freeze frame de {freeze_duration_sec}s injetado com sucesso no segundo {click_timestamp_sec}")
        return True
    except Exception as e:
        logger.error(f"Erro na injeção de freeze frame via FFmpeg: {e}")
        return False
