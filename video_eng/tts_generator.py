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

from dotenv import load_dotenv
load_dotenv()

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
    texto_falado = re.sub(r"(?i)\bsign\b", "sáin", texto_falado)
    
    # Anti-engasgos do TTS
    texto_falado = texto_falado.replace("_", " ")
    texto_falado = re.sub(r"\s*[|/]\s*", ", ", texto_falado)
    texto_falado = re.sub(r" {2,}", " ", texto_falado).strip()

    # Cache MD5: verificar se já existe áudio em cache para este texto com essa voz
    cache_key = f"{texto_falado}_{voz}"
    text_hash = hashlib.md5(cache_key.encode()).hexdigest()
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

    # --- Prioridade 1: MiniMax Audio ---
    minimax_key = os.getenv("MINIMAX_API_KEY", "")
    minimax_group = os.getenv("MINIMAX_GROUP_ID", "")
    
    logger.info(f"MiniMax API Key: {'SET' if minimax_key else 'EMPTY'} | Group ID: {'SET' if minimax_group else 'EMPTY'}")

    if minimax_key and minimax_group:
        try:
            import requests as req
            url = f"https://api.minimax.io/v1/t2a_v2?GroupId={minimax_group}"
            headers = {
                "Authorization": f"Bearer {minimax_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "speech-2.8-turbo",
                "text": texto_falado,
                "stream": False,
                "voice_setting": {
                    "voice_id": voz,
                    "speed": 1.0,
                    "vol": 1.0,
                    "pitch": 0
                },
                "audio_setting": {
                    "sample_rate": 32000,
                    "bitrate": 128000,
                    "format": "mp3"
                }
            }
            
            # Chama a API de forma assíncrona usando threads
            response = await asyncio.to_thread(req.post, url, headers=headers, json=payload, timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"MiniMax JSON Response: {result}")
                
                audio_data = result.get("data", {}).get("audio", "")
                
                if audio_data:
                    # A API pode retornar HEX ou URL
                    if not audio_data.startswith("http"):
                        with open(output_path, "wb") as f:
                            f.write(bytes.fromhex(audio_data))
                    else:
                        audio_resp = await asyncio.to_thread(req.get, audio_data, timeout=30)
                        with open(output_path, "wb") as f:
                            f.write(audio_resp.content)
                            
                    # Tenta salvar no cache
                    try:
                        shutil.copy2(output_path, cache_path)
                        logger.info(f"TTS MiniMax gerado e salvo no cache: {cache_path}")
                    except Exception as e:
                        pass
                    return True
                else:
                    logger.warning(f"MiniMax retornou 200 mas sem audio: {result}")
            else:
                logger.warning(f"MiniMax retornou erro HTTP {response.status_code}: {response.text}")
        except Exception as e:
            logger.warning(f"Falha na API MiniMax: {e}")
            
    # --- Prioridade 2: Azure (edge-tts) ---
    logger.info("Tentando fallback Azure (edge-tts)...")
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
        logger.error(f"Falha ao gerar TTS via edge-tts para o texto '{texto}': {e}. Tentando fallback OpenAI TTS...")
        openai_key = os.getenv("OPENAI_API_KEY", "")
        if openai_key:
            try:
                from openai import AsyncOpenAI
                client = AsyncOpenAI(api_key=openai_key)
                response = await client.audio.speech.create(
                    model="tts-1",
                    voice="nova", # Vozes: alloy, echo, fable, onyx, nova, shimmer
                    input=texto_falado
                )
                
                # Salvar arquivo
                if hasattr(response, "write_to_file"):
                    import inspect
                    if inspect.iscoroutinefunction(response.write_to_file):
                        await response.write_to_file(output_path)
                    else:
                        response.write_to_file(output_path)
                elif hasattr(response, "stream_to_file"):
                    import inspect
                    if inspect.iscoroutinefunction(response.stream_to_file):
                        await response.stream_to_file(output_path)
                    else:
                        response.stream_to_file(output_path)
                else:
                    with open(output_path, "wb") as f:
                        f.write(response.content)
                
                # Tentar salvar no cache
                try:
                    shutil.copy2(output_path, cache_path)
                except:
                    pass
                    
                return True
            except Exception as e2:
                logger.error(f"Falha total no TTS (Edge e OpenAI) para o texto '{texto}': {e2}")
                return False
        else:
            logger.error("OPENAI_API_KEY não configurada para o fallback de TTS.")
            return False
