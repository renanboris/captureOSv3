import os
import re
import edge_tts
import logging
import asyncio

logger = logging.getLogger(__name__)

async def gerar_audio(texto: str, output_path: str, voz: str = "pt-BR-FranciscaNeural") -> bool:
    """
    Converte texto em áudio MP3 usando o motor neural (Google/Edge).
    Aplica as regras de limpeza de fonética do sistema legado.
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

    try:
        communicate = edge_tts.Communicate(texto_falado, voz, rate="-8%", pitch="-5Hz", volume="+8%")
        await communicate.save(output_path)
        return True
    except Exception as e:
        logger.error(f"Falha ao gerar TTS para o texto '{texto}': {e}")
        return False
