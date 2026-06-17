import os
import logging
from supabase import create_client, Client
from config.settings import get_settings

logger = logging.getLogger(__name__)

def upload_video(local_path: str, session_id: str) -> str | None:
    """
    Faz o upload do vídeo final para o bucket 'videos' do Supabase Storage.
    Retorna a URL pública em caso de sucesso.
    Retorna None em caso de falha ou se o Supabase não estiver configurado (Fallback local).
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_key:
        logger.warning("Supabase não configurado. Usando armazenamento local para o vídeo.")
        return None
        
    if not os.path.exists(local_path):
        logger.error(f"Arquivo não encontrado para upload: {local_path}")
        return None

    try:
        supabase: Client = create_client(settings.supabase_url, settings.supabase_key)
        file_name = f"{session_id}_final.mp4"
        
        logger.info(f"Iniciando upload de {local_path} para o Supabase Storage...")
        with open(local_path, 'rb') as f:
            # Upload the file
            supabase.storage.from_("videos").upload(
                path=file_name,
                file=f,
                file_options={"content-type": "video/mp4", "x-upsert": "true"}
            )
            
        public_url = supabase.storage.from_("videos").get_public_url(file_name)
        logger.info(f"Upload para Nuvem concluído com sucesso: {public_url}")
        return public_url
    except Exception as e:
        logger.error(f"Falha crítica no upload para o Supabase. O vídeo continuará local. Erro: {e}")
        return None
