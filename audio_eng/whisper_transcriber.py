import logging
import asyncio
import os
from typing import Optional

logger = logging.getLogger(__name__)

async def transcrever_audio_instrutor(audio_webm_b64: str, session_id: str) -> Optional[str]:
    """
    Transcreve o áudio do microfone do instrutor usando Whisper.
    Retorna o texto transcrito ou None se falhar/não houver áudio.
    """
    if not audio_webm_b64:
        return None

    try:
        import base64
        from openai import AsyncOpenAI
        from config.settings import get_settings

        settings = get_settings()
        if not settings.openai_api_key:
            logger.warning("OpenAI key ausente — transcrição de voz desativada")
            return None

        audio_bytes = base64.b64decode(audio_webm_b64.split(',')[-1])
        tmp_path = f"/tmp/instrutor_{session_id}.webm"
        # Garante que o diretorio exista
        os.makedirs("/tmp", exist_ok=True)
        
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

        os.remove(tmp_path)
        logger.info(f"Transcrição do instrutor concluída: {len(transcription)} chars")
        return transcription

    except Exception as e:
        logger.error(f"Erro na transcrição Whisper: {e}")
        return None
