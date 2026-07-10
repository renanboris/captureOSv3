import logging
import asyncio
import os
from typing import Optional

logger = logging.getLogger(__name__)

async def transcrever_audio_instrutor(audio_input: bytes | str, session_id: str) -> Optional[str]:
    """
    Transcreve o áudio do microfone do instrutor usando Whisper.
    Retorna o texto transcrito ou None se falhar/não houver áudio.
    """
    if not audio_input:
        return None

    try:
        import base64
        from openai import AsyncOpenAI
        from config.settings import get_settings

        settings = get_settings()
        if not settings.openai_api_key:
            logger.warning("OpenAI key ausente — transcrição de voz desativada")
            return None

        if isinstance(audio_input, str):
            audio_bytes = base64.b64decode(audio_input.split(',')[-1])
        else:
            audio_bytes = audio_input

        tmp_dir = "data/tmp"
        os.makedirs(tmp_dir, exist_ok=True)
        tmp_path = os.path.join(tmp_dir, f"instrutor_{session_id}.webm")
        
        try:
            with open(tmp_path, "wb") as f:
                f.write(audio_bytes)

            client = AsyncOpenAI(api_key=settings.openai_api_key)
            
            with open(tmp_path, "rb") as audio_file:
                transcription = await client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    language="pt",
                    response_format="text"
                )

            logger.info(f"Transcrição do instrutor concluída: {len(transcription)} chars")
            return transcription
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    except Exception as e:
        logger.error(f"Erro na transcrição Whisper: {e}")
        return None
