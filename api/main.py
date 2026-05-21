from fastapi import FastAPI, Request
import json
import logging
import base64
from pydantic import BaseModel
from typing import List, Any
from vision.som_annotator import anotar_imagem_coordenadas
from api.intelligence_engine import processar_intencao

app = FastAPI(title="Capture OS v3 Ingestion API")
logger = logging.getLogger("uvicorn.error")

class EventPayload(BaseModel):
    session_id: str
    events: List[Any]

@app.post("/api/v1/capture/ingest")
async def ingest_capture(payload: EventPayload):
    logger.info(f"Recebido payload da sessão: {payload.session_id}")
    
    roteiro = []
    
    # Processa cada evento isoladamente (mockando comportamento real de pipeline)
    for idx, ev in enumerate(payload.events):
        event_data = ev.get('eventData', {})
        a11y_tree = event_data.get('a11y_tree', [])
        
        # O screenshot é base64 jpeg
        b64_data = ev.get('screenshotData', '').split(',')[-1]
        raw_bytes = base64.b64decode(b64_data) if b64_data else b""
        
        # Pegar as coordenadas da A11y Tree
        boxes = []
        for node in a11y_tree:
            geom = node.get('geometry')
            if geom:
                boxes.append({
                    "idx": node.get("som_id"),
                    "x": geom["x"],
                    "y": geom["y"],
                    "w": geom["w"],
                    "h": geom["h"]
                })
        
        # 1. Anota a imagem usando PIL
        if raw_bytes and boxes:
            annotated_bytes = anotar_imagem_coordenadas(raw_bytes, boxes)
        else:
            annotated_bytes = raw_bytes
            
        # 2. Motor de Inteligência Semântica
        resultado = await processar_intencao(annotated_bytes, event_data, a11y_tree)
        
        roteiro.append({
            "passo": idx + 1,
            "timestamp": ev.get("timestamp"),
            "intencao": resultado
        })
        
    # Salva localmente para auditoria
    try:
        with open("data/roteiro_gerado.json", "w", encoding="utf-8") as f:
            json.dump({"session_id": payload.session_id, "roteiro": roteiro}, f, ensure_ascii=False, indent=2)
        logger.info("Roteiro salvo em data/roteiro_gerado.json")
    except Exception as e:
        logger.error(f"Erro ao salvar arquivo JSON: {e}")

    return {"status": "ok", "roteiro_gerado": roteiro}
