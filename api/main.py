from fastapi import FastAPI, Request
import json
import logging
import base64
from pydantic import BaseModel
from typing import List, Any, Dict
from vision.som_annotator import anotar_imagem_coordenadas
from api.export_pipeline import renderizar_exportacao
from api.rerender_pipeline import rerenderizar_com_roteiro_aprovado
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

# Servir frontend editor
os.makedirs("frontend/editor", exist_ok=True)
app.mount("/editor", StaticFiles(directory="frontend/editor", html=True), name="editor")

# Servir screenshots
# Servir screenshots
os.makedirs("data/simlink_screenshots", exist_ok=True)
app.mount("/screenshots", StaticFiles(directory="data/simlink_screenshots"), name="screenshots")

# Servir frontend simlink
os.makedirs("frontend/simlink", exist_ok=True)
app.mount("/simlink", StaticFiles(directory="frontend/simlink", html=True), name="simlink")

# Pasta para dados do simlink
os.makedirs("data/simlink", exist_ok=True)

class EventPayload(BaseModel):
    session_id: str
    recording_start_time: int = 0
    events: List[Dict[str, Any]] = []
    video_webm: str = ""
    audio_instrutor_webm: str = ""
    modo_input: str = "A"
    roteiro_manual: List[Dict[str, Any]] = []

class RoteiroEditadoPayload(BaseModel):
    roteiro: List[Dict[str, Any]]
    modo_input: str = "A"
    aprovado: bool = False

from fastapi import HTTPException

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
        roteiro_data = []
        try:
            roteiro_path = f"data/roteiros/{session_id}.json"
            if os.path.exists(roteiro_path):
                with open(roteiro_path, "r", encoding="utf-8") as f:
                    roteiro_json = json.load(f)
                    roteiro_data = roteiro_json.get("roteiro", [])
        except Exception as e:
            logger.error(f"Erro ao ler roteiro para retorno: {e}")

        return {
            "status": "completed", 
            "url": f"http://localhost:8000/videos_gerados/{session_id}_final.mp4",
            "roteiro": roteiro_data
        }
        
    return status_data

@app.get("/api/v1/session/{session_id}/roteiro")
async def get_roteiro(session_id: str):
    roteiro_path = f"data/roteiros/{session_id}.json"
    if not os.path.exists(roteiro_path):
        raise HTTPException(status_code=404, detail="Roteiro não encontrado")
    with open(roteiro_path, "r", encoding="utf-8") as f:
        return json.load(f)

@app.post("/api/v1/session/{session_id}/roteiro")
async def save_roteiro(session_id: str, payload: RoteiroEditadoPayload):
    roteiro_path = f"data/roteiros/{session_id}.json"
    
    with open(roteiro_path, "w", encoding="utf-8") as f:
        json.dump({"session_id": session_id, "roteiro": payload.roteiro}, f, ensure_ascii=False, indent=2)
        
    if payload.aprovado:
        update_status(session_id, "rendering_final", "Renderizando vídeo final com roteiro aprovado...")
        asyncio.create_task(rerenderizar_com_roteiro_aprovado(session_id, payload.roteiro))
        
    return {"status": "ok"}

@app.get("/api/v1/simlink/{modulo_id}")
async def get_simlink_modulo(modulo_id: str):
    # Procura pelo módulo
    import glob
    for filepath in glob.glob("data/simlink/*.json"):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                mod = json.load(f)
                if mod.get("modulo_id") == modulo_id:
                    return mod
        except:
            pass
    raise HTTPException(status_code=404, detail="Módulo Simlink não encontrado")

@app.post("/api/v1/simlink/{modulo_id}/conclusao")
async def registrar_conclusao_simlink(modulo_id: str, payload: dict):
    # Busca módulo e dispara callback LMS se necessário
    import glob
    from simlink_eng.lms_callback import reportar_conclusao_lms
    
    modulo_path = f"data/simlink/{modulo_id}_resultado.json"
    with open(modulo_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
        
    for filepath in glob.glob("data/simlink/*.json"):
        if not filepath.endswith("_resultado.json"):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    mod = json.load(f)
                    if mod.get("modulo_id") == modulo_id and mod.get("lms_callback_url"):
                        asyncio.create_task(reportar_conclusao_lms(
                            mod["lms_callback_url"], 
                            mod.get("lms_callback_token", ""),
                            modulo_id,
                            payload.get("xp", 0),
                            mod.get("xp_max", 0),
                            payload.get("completado", True)
                        ))
                        break
            except:
                pass
    return {"status": "ok"}

@app.post("/api/v1/session/{session_id}/simlink/configure")
async def configurar_simlink(session_id: str, payload: dict):
    filepath = f"data/simlink/{session_id}.json"
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Módulo Simlink não gerado ainda")
    
    with open(filepath, "r", encoding="utf-8") as f:
        mod = json.load(f)
        
    mod["lms_callback_url"] = payload.get("lms_callback_url")
    mod["lms_callback_token"] = payload.get("lms_token")
    if payload.get("titulo"):
        mod["titulo"] = payload.get("titulo")
        
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(mod, f, ensure_ascii=False, indent=2)
        
    # BACKEND_URL real viria do settings, mas usando hardcode por enquanto para simplificar
    return {"simlink_url": f"http://localhost:8000/simlink?modulo={mod['modulo_id']}"}

sandbox_states = {}

class SandboxActionPayload(BaseModel):
    session_id: str
    url: str
    action_data: dict

@app.post("/api/v1/sandbox/evaluate")
async def evaluate_sandbox(payload: SandboxActionPayload):
    from sandbox_eng.arbitro_engine import avaliar_acao_sandbox
    
    session_id = payload.session_id
    if session_id not in sandbox_states:
        sandbox_states[session_id] = 1 # começa no passo 1
        
    passo_esperado = sandbox_states[session_id]
    
    roteiro_path = f"data/roteiros/{session_id}.json"
    if not os.path.exists(roteiro_path):
        return {"is_correct": False, "hint": "Roteiro não encontrado"}
        
    with open(roteiro_path, "r", encoding="utf-8") as f:
        roteiro = json.load(f).get("roteiro", [])
        
    # Filtrar apenas os passos reais (ignorar 0 e 999 se houver)
    roteiro_filtrado = [p for p in roteiro if p.get("passo", 0) not in (0, 999)]
    
    result = await avaliar_acao_sandbox(roteiro_filtrado, passo_esperado, payload.action_data)
    
    if result.get("is_correct"):
        sandbox_states[session_id] += 1
        
    return result
