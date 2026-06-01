import os
import re
import edge_tts
import logging
import asyncio
import hashlib
import shutil

logger = logging.getLogger(__name__)

# Diretório de cache para áudios TTS gerados
TTS_CACHE_DIR = "data/cache/tts"

async def gerar_audio(texto: str, output_path: str, voz: str = "pt-BR-FranciscaNeural") -> bool:
    """
    Converte texto em áudio MP3 usando o motor neural (Google/Edge).
    Aplica as regras de limpeza de fonética do sistema legado.
    Utiliza cache MD5 para evitar re-geração de áudios idênticos.
    """
    if not texto or not texto.strip():
        return False

    # Correções fonéticas corporativas (legado)
    texto_falado = re.sub(r"(?i)\becm_ged\b", "E C M gédi", texto)
    texto_falado = re.sub(r"\bGED\b", "gédi", texto_falado)
    texto_falado = re.sub(r"\bged\b", "gédi", texto_falado)
    texto_falado = re.sub(r"(?i)\bsenior\b", "Sênior", texto_falado)
    texto_falado = re.sub(r"\bX\b", "Éks", texto_falado)
    texto_falado = re.sub(r"(?i)\btemplates?\b", lambda m: "têmpleits" if m.group().lower().endswith("s") else "têmpleit", texto_falado)
    
    # Anti-engasgos do TTS
    texto_falado = texto_falado.replace("_", " ")
    texto_falado = re.sub(r"\s*[|/]\s*", ", ", texto_falado)
    texto_falado = re.sub(r" {2,}", " ", texto_falado).strip()

    # Cache MD5: verificar se já existe áudio em cache para este texto
    text_hash = hashlib.md5(texto_falado.encode()).hexdigest()
    os.makedirs(TTS_CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(TTS_CACHE_DIR, f"{text_hash}.mp3")

    if os.path.exists(cache_path):
        # Áudio já em cache — copiar diretamente para o destino
        try:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            shutil.copy2(cache_path, output_path)
            logger.info(f"TTS cache hit: {cache_path} → {output_path}")
            return True
        except Exception as e:
            logger.warning(f"Falha ao copiar cache TTS, gerando novamente: {e}")

    try:
        communicate = edge_tts.Communicate(texto_falado, voz, rate="-8%", pitch="-5Hz", volume="+8%")
        await communicate.save(output_path)

        # Salvar resultado no cache para reutilização futura
        try:
            shutil.copy2(output_path, cache_path)
            logger.info(f"TTS cache salvo: {cache_path}")
        except Exception as e:
            logger.warning(f"Falha ao salvar cache TTS: {e}")

        return True
    except Exception as e:
        logger.error(f"Falha ao gerar TTS para o texto '{texto}': {e}")
        return False
