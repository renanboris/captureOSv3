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
from fastapi.middleware.cors import CORSMiddleware
from config.settings import get_settings
settings = get_settings()

active_tasks: Dict[str, asyncio.Task] = {}

app = FastAPI(title="Capture OS v3 Ingestion API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger("uvicorn.error")

# Servir os vídeos finalizados como arquivos estáticos (Player)
os.makedirs("data/videos_gerados", exist_ok=True)
app.mount("/videos_gerados", StaticFiles(directory="data/videos_gerados"), name="videos_gerados")

# Servir frontend editor
os.makedirs("frontend/editor", exist_ok=True)
app.mount("/editor", StaticFiles(directory="frontend/editor", html=True), name="editor")

os.makedirs("data/artifacts", exist_ok=True)
app.mount("/artifacts", StaticFiles(directory="data/artifacts"), name="artifacts")

# Servir screenshots
os.makedirs("data/simlink_screenshots", exist_ok=True)
app.mount("/screenshots", StaticFiles(directory="data/simlink_screenshots"), name="screenshots")

# Servir frontend simlink
os.makedirs("frontend/simlink", exist_ok=True)
app.mount("/simlink", StaticFiles(directory="frontend/simlink", html=True), name="simlink")

# Pasta para dados do simlink
os.makedirs("data/simlink", exist_ok=True)

# Servir SCORMs gerados
os.makedirs("data/scorm", exist_ok=True)
app.mount("/scorm", StaticFiles(directory="data/scorm"), name="scorm")

# Servir Áudios gerados
os.makedirs("data/audios", exist_ok=True)
app.mount("/audios", StaticFiles(directory="data/audios"), name="audios")

# Servir Player Standalone do SCORM usando os mesmos templates do pacote
os.makedirs("scorm_eng/templates", exist_ok=True)
app.mount("/scorm-player", StaticFiles(directory="scorm_eng/templates", html=True), name="scorm_player")

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

class TTSPreviewPayload(BaseModel):
    texto: str

from fastapi import HTTPException

@app.post("/api/v1/capture/ingest")
async def ingest_capture(payload: EventPayload):
    logger.info(f"Recebido payload da sessão: {payload.session_id}")
    
    update_status(payload.session_id, "processing", "Recebendo imagens...")

    # Dispara o Pipeline Completo (IA + Vídeo) DESACOPLADO da requisição!
    payload_dict = payload.model_dump()
    task = asyncio.create_task(renderizar_exportacao(payload_dict))
    active_tasks[payload.session_id] = task
    task.add_done_callback(lambda t: active_tasks.pop(payload.session_id, None))

    return {"status": "ok", "session_id": payload.session_id}

@app.post("/api/v1/capture/abort/{session_id}")
async def abort_capture(session_id: str):
    logger.info(f"Recebido pedido de abort para sessão: {session_id}")
    update_status(session_id, "failed", "Processamento cancelado pelo usuário.")
    if session_id in active_tasks:
        task = active_tasks[session_id]
        if not task.done():
            task.cancel()
            logger.info(f"Task cancelada para a sessão {session_id}")
        active_tasks.pop(session_id, None)
    return {"status": "ok"}

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
            "url": f"{settings.backend_url}/videos_gerados/{session_id}_final.mp4",
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
    
    existing_data = {}
    if os.path.exists(roteiro_path):
        with open(roteiro_path, "r", encoding="utf-8") as f:
            try:
                existing_data = json.load(f)
            except:
                pass
                
    existing_data["session_id"] = session_id
    existing_data["roteiro"] = payload.roteiro
    
    with open(roteiro_path, "w", encoding="utf-8") as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)
        
    if payload.aprovado:
        status_data = get_status(session_id)
        if status_data.get("status") == "rendering_final":
            return {"status": "ok", "message": "Já está renderizando"}
        
        update_status(session_id, "rendering_final", "Renderizando vídeo final com roteiro aprovado...")
        task = asyncio.create_task(rerenderizar_com_roteiro_aprovado(session_id, payload.roteiro))
        active_tasks[session_id] = task
        task.add_done_callback(lambda t: active_tasks.pop(session_id, None))
        
    return {"status": "ok"}

@app.post("/api/v1/session/{session_id}/passo/{passo_num}/regerar")
async def regerar_passo(session_id: str, passo_num: int):
    """
    Rechama a Aura para regeração de um único passo, com contexto dos vizinhos.
    Retorna o passo atualizado sem salvar — o editor decide se aceita.
    """
    roteiro_path = f"data/roteiros/{session_id}.json"
    if not os.path.exists(roteiro_path):
        raise HTTPException(status_code=404, detail="Roteiro não encontrado")

    with open(roteiro_path) as f:
        data = json.load(f)
    roteiro = data.get("roteiro", [])

    # Encontrar o passo e seus vizinhos para contexto
    passo_alvo = next((p for p in roteiro if p.get("passo") == passo_num), None)
    if not passo_alvo:
        raise HTTPException(status_code=404, detail=f"Passo {passo_num} não encontrado")

    passo_anterior = next((p for p in roteiro if p.get("passo") == passo_num - 1), None)
    passo_seguinte = next((p for p in roteiro if p.get("passo") == passo_num + 1), None)

    from api.intelligence_engine import regerar_passo_isolado
    passo_atualizado = await regerar_passo_isolado(passo_alvo, passo_anterior, passo_seguinte)

    return {"passo": passo_atualizado}

@app.post("/api/v1/tts/preview")
async def tts_preview(payload: TTSPreviewPayload):
    from video_eng.tts_generator import gerar_audio
    import uuid
    os.makedirs("data/artifacts/previews", exist_ok=True)
    filename = f"preview_{uuid.uuid4().hex}.mp3"
    filepath = f"data/artifacts/previews/{filename}"
    sucesso = await gerar_audio(payload.texto, filepath)
    if not sucesso:
        raise HTTPException(status_code=500, detail="Falha ao gerar TTS")
    
    base = settings.backend_url
    url = f"{base}/artifacts/previews/{filename}"
    return {"audio_url": url}

@app.get("/api/v1/session/{session_id}/artifacts")
async def get_artifacts(session_id: str):
    """Retorna URLs de todos os artefatos gerados para uma sessão."""
    base = settings.backend_url
    art_dir = f"data/artifacts/{session_id}"
    sim_dir = f"data/simlink"

    def url_if_exists(local_path: str, public_url: str) -> str | None:
        return public_url if os.path.exists(local_path) else None

    # Buscar modulo_id do simlink
    simlink_url = None
    simlink_path = f"{sim_dir}/{session_id}.json"
    if os.path.exists(simlink_path):
        try:
            with open(simlink_path) as f:
                mod = json.load(f)
                simlink_url = f"{base}/simlink?modulo={mod.get('modulo_id', '')}"
        except:
            pass

    # Ler quiz se existir
    quiz_data = []
    quiz_path = f"{art_dir}/quiz.json"
    if os.path.exists(quiz_path):
        try:
            with open(quiz_path) as f:
                quiz_data = json.load(f)
        except:
            pass

    return {
        "session_id": session_id,
        "video_url":       url_if_exists(f"data/videos_gerados/{session_id}_final.mp4",
                                         f"{base}/videos_gerados/{session_id}_final.mp4"),
        "pdf_url":         url_if_exists(f"{art_dir}/apostila.pdf",
                                         f"{base}/artifacts/{session_id}/apostila.pdf"),
        "transcript_url":  url_if_exists(f"{art_dir}/transcricao.txt",
                                         f"{base}/artifacts/{session_id}/transcricao.txt"),
        "quiz":            quiz_data,
        "simlink_url":     simlink_url,
        "scorm_download_url": url_if_exists(f"data/scorm/{session_id}.zip", f"{base}/scorm/{session_id}.zip"),
        "scorm_player_url": f"{base}/scorm-player?modulo={mod.get('modulo_id', '')}" if simlink_url else None,
        "status":          get_status(session_id).get("status", "unknown")
    }

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

@app.get("/api/v1/modulos")
async def listar_modulos(dominio: str = ""):
    """
    Lista módulos Simlink disponíveis, filtrados opcionalmente por domínio.
    Usado pelo popup para descobrir módulos disponíveis para a aba atual.
    """
    import glob
    modulos = []

    for filepath in glob.glob("data/simlink/*.json"):
        # Ignorar arquivos _resultado.json
        if filepath.endswith("_resultado.json"):
            continue
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                mod = json.load(f)

            # Filtrar por domínio se fornecido
            mod_dominio = mod.get("dominio", "")
            if dominio and mod_dominio and dominio not in mod_dominio and mod_dominio not in dominio:
                continue

            modulos.append({
                "modulo_id":    mod.get("modulo_id"),
                "titulo":       mod.get("titulo"),
                "total_passos": mod.get("total_passos"),
                "xp_max":       mod.get("xp_max"),
                "dominio":      mod_dominio,
                "criado_em":    mod.get("criado_em"),
                "session_id":   mod.get("session_id")
            })
        except Exception as e:
            logger.warning(f"Erro ao ler módulo {filepath}: {e}")

    # Ordenar por data de criação (mais recente primeiro)
    modulos.sort(key=lambda m: m.get("criado_em", ""), reverse=True)
    return {"modulos": modulos, "total": len(modulos)}

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
        
    return {"simlink_url": f"{settings.backend_url}/simlink?modulo={mod['modulo_id']}"}

def get_sandbox_state(session_id: str) -> int:
    path = f"data/status/sandbox_{session_id}.json"
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f).get("passo", 1)
        except:
            pass
    return 1

def set_sandbox_state(session_id: str, passo: int):
    os.makedirs("data/status", exist_ok=True)
    with open(f"data/status/sandbox_{session_id}.json", "w") as f:
        json.dump({"passo": passo}, f)

class SandboxActionPayload(BaseModel):
    session_id: str
    url: str
    action_data: dict

@app.post("/api/v1/sandbox/evaluate")
async def evaluate_sandbox(payload: SandboxActionPayload):
    from sandbox_eng.arbitro_engine import avaliar_acao_sandbox
    
    modulo_id = payload.session_id
    session_id = modulo_id
    
    simlink_path = f"data/simlink/{modulo_id}.json"
    if os.path.exists(simlink_path):
        with open(simlink_path, "r", encoding="utf-8") as f:
            mod = json.load(f)
            session_id = mod.get("session_id", modulo_id)

    passo_esperado = get_sandbox_state(modulo_id)
    
    roteiro_path = f"data/roteiros/{session_id}.json"
    if not os.path.exists(roteiro_path):
        return {"is_correct": False, "hint": "Roteiro não encontrado"}
        
    with open(roteiro_path, "r", encoding="utf-8") as f:
        roteiro = json.load(f).get("roteiro", [])
        
    # Filtrar apenas os passos reais (ignorar 0 e 999 se houver)
    roteiro_filtrado = [p for p in roteiro if p.get("passo", 0) not in (0, 999)]
    
    result = await avaliar_acao_sandbox(roteiro_filtrado, passo_esperado, payload.action_data)
    
    if result.get("is_correct"):
        set_sandbox_state(modulo_id, passo_esperado + 1)
        
    return result

@app.post("/api/v1/sandbox/reset")
async def reset_sandbox(payload: dict):
    """Reseta o estado do sandbox para uma sessão (usado ao iniciar nova prática)."""
    session_id = payload.get("session_id", "")
    if session_id:
        path = f"data/status/sandbox_{session_id}.json"
        if os.path.exists(path):
            os.remove(path)
    return {"status": "ok"}
