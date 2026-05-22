from fastapi import FastAPI, Request
import json
import logging
import base64
from pydantic import BaseModel
from typing import List, Any, Dict
from vision.som_annotator import anotar_imagem_coordenadas
from api.export_pipeline import renderizar_exportacao
from api.status_manager import get_status, update_status
from fastapi import BackgroundTasks
from fastapi.staticfiles import StaticFiles
import os
import asyncio

app = FastAPI(title="Capture OS v3 Ingestion API")
logger = logging.getLogger("uvicorn.error")

# Servir os vídeos finalizados como arquivos estáticos (Player)
os.makedirs("data/videos_gerados", exist_ok=True)
app.mount("/videos_gerados", StaticFiles(directory="data/videos_gerados"), name="videos_gerados")

class EventPayload(BaseModel):
    session_id: str
    recording_start_time: int = 0
    events: List[Dict[str, Any]] = []
    video_webm: str = ""

@app.post("/api/v1/capture/ingest")
async def ingest_capture(payload: EventPayload):
    logger.info(f"Recebido payload da sessão: {payload.session_id}")
    
    update_status(payload.session_id, "processing", "Recebendo imagens...")

    # Dispara o Pipeline Completo (IA + Vídeo) DESACOPLADO da requisição!
    payload_dict = payload.model_dump()
    asyncio.create_task(renderizar_exportacao(payload_dict))

    return {"status": "ok", "session_id": payload.session_id}

@app.get("/api/v1/capture/status/{session_id}")
async def check_status(session_id: str):
    status_data = get_status(session_id)
    if status_data.get("status") == "completed":
        return {
            "status": "completed", 
            "url": f"http://localhost:8000/videos_gerados/{session_id}_final.mp4"
        }
        
    return status_data
