from fastapi import FastAPI, Request, Depends, Response, UploadFile, File, Form
import json
import logging
import base64
from pydantic import BaseModel, field_validator
from typing import List, Any, Dict, Optional
from vision.som_annotator import anotar_imagem_coordenadas
from api.export_pipeline import renderizar_exportacao
from api.rerender_pipeline import rerenderizar_com_roteiro_aprovado
from api.status_manager import get_status, update_status
from api.auth import require_auth
from fastapi import BackgroundTasks
from fastapi.staticfiles import StaticFiles
import os
import asyncio
from fastapi.middleware.cors import CORSMiddleware
from config.settings import get_settings

# Increase multipart upload limit to 500 MB before the app is created.
# The default Starlette limit is 1 MB per part (MultiPartParser.__init__ default),
# which is too small for screen recordings.
# The limit lives as a default argument in Request._get_form and Request.form —
# we patch those defaults directly so FastAPI's form dependency injection picks
# up the new value without needing to change every call site.
import starlette.requests as _sr
_500_MB = 500 * 1024 * 1024

def _patch_default(fn, param: str, value: int):
    """Replace a keyword-argument default in a function/coroutine."""
    import inspect
    sig = inspect.signature(fn)
    if param not in sig.parameters:
        return
    defaults = fn.__kwdefaults__ or {}
    defaults[param] = value
    fn.__kwdefaults__ = defaults

_patch_default(_sr.Request._get_form, "max_part_size", _500_MB)
_patch_default(_sr.Request.form, "max_part_size", _500_MB)

settings = get_settings()

# Auth sempre ativa. Em dev, o secret padrão aceita tokens assinados com ele
# (jwt_factory nos testes). O aviso abaixo lembra de configurar um secret forte
# em produção, mas não desabilita a proteção — uma rota sem token recebe 401
# independentemente do ambiente.
_DEV_SECRET = "dev-secret-change-in-prod"
_auth_deps = [Depends(require_auth)]

if not settings.jwt_secret or settings.jwt_secret == _DEV_SECRET:
    logging.getLogger("uvicorn.error").warning(
        "AUTH ATIVA com jwt_secret padrão de dev. "
        "Configure JWT_SECRET no .env com um valor forte antes de ir para produção."
    )

active_tasks: Dict[str, asyncio.Task] = {}


def _task_exception_handler(task: asyncio.Task):
    """Log unhandled exceptions from background pipeline tasks."""
    try:
        exc = task.exception()
    except asyncio.CancelledError:
        return
    if exc:
        import traceback
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        logging.getLogger("uvicorn.error").error(
            f"[PIPELINE ERROR] Background task failed:\n{tb}"
        )

app = FastAPI(title="Capture OS v3 Ingestion API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger("uvicorn.error")

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"VALIDATION ERROR em {request.method} {request.url.path}: {exc.errors()}")
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

@app.exception_handler(400)
async def bad_request_handler(request: Request, exc):
    logger.error(f"400 BAD REQUEST em {request.method} {request.url.path}: {exc}")
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.middleware("http")
async def no_cache_for_editor(request: Request, call_next):
    """Disable browser caching for the editor SPA assets.

    The editor is served from the backend and embedded as an iframe by the
    extension. Without this, browsers aggressively cache editor.js and serve a
    stale build that does not attach the auth token.
    """
    response = await call_next(request)
    if request.url.path.startswith("/editor"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.middleware("http")
async def reject_modo_c_middleware(request: Request, call_next):
    """Reject Modo C at the ingest boundary before any route logic (incl. auth).

    Property 11 / Requirement 2.15: the undocumented, UI-less, test-less Modo C
    path is disabled.

    For JSON bodies: parse and check ``modo_input`` here — before the route
    dependency chain runs — so the 422 fires regardless of auth state.

    For multipart/form-data bodies (task 14.4 binary upload): the form stream
    cannot be consumed in middleware without breaking the route, so Modo C is
    checked inside the route handler itself (the ``modo_input`` Form field check
    at the top of ``ingest_capture``).
    """
    if request.method == "POST" and request.url.path == "/api/v1/capture/ingest":
        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                body_bytes = await request.body()
                body_json = json.loads(body_bytes)
                if body_json.get("modo_input") == "C":
                    return Response(
                        content=json.dumps({
                            "detail": [
                                {
                                    "type": "value_error",
                                    "loc": ["body", "modo_input"],
                                    "msg": (
                                        "Value error, modo_input='C' (Modo C / roteiro_manual) "
                                        "is disabled: this code path has no UI, no documentation, "
                                        "and no tests. Only Modo A and Modo B are supported."
                                    ),
                                    "input": "C",
                                    "ctx": {"error": "Modo C is disabled"},
                                }
                            ]
                        }),
                        status_code=422,
                        media_type="application/json",
                    )
            except (json.DecodeError, UnicodeDecodeError):
                pass  # Let the normal request parsing handle malformed JSON
        # For multipart/form-data: Modo C is rejected inside the route handler.
    return await call_next(request)

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


@app.get("/api/v1/health")
async def health():
    """Readiness/liveness probe for load balancers and deploy processes.

    Intentionally unauthenticated and side-effect free so it stays reachable
    even after authentication is added to the data routes. Health is not a
    data route.
    """
    return {"status": "ok"}


class EventPayload(BaseModel):
    session_id: str
    recording_start_time: int = 0
    events: List[Dict[str, Any]] = []
    video_webm: str = ""
    audio_instrutor_webm: str = ""
    modo_input: str = "A"
    roteiro_manual: List[Dict[str, Any]] = []

    @field_validator("modo_input")
    @classmethod
    def modo_c_is_disabled(cls, v: str) -> str:
        """Reject Modo C (roteiro_manual) — undocumented, no UI, no tests.

        Property 11 / Requirement 2.15: the Modo C path is disabled until a
        documented, UI-supported, tested use case exists.  A Pydantic validator
        fires during request-body parsing, before FastAPI runs any route
        dependency (including ``require_auth``), so the 422 is returned
        regardless of authentication state.
        """
        if v == "C":
            raise ValueError(
                "modo_input='C' (Modo C / roteiro_manual) is disabled: "
                "this code path has no UI, no documentation, and no tests. "
                "Only Modo A and Modo B are supported."
            )
        return v

class RoteiroEditadoPayload(BaseModel):
    roteiro: List[Dict[str, Any]]
    titulo: Optional[str] = None
    modo_input: str = "A"
    aprovado: bool = False
    usar_overlay: bool = True
    voice_id: str = "Portuguese_Casual_Speaker_v1"

class TTSPreviewPayload(BaseModel):
    texto: str
    voice_id: str = "Portuguese_Casual_Speaker_v1"

class UploadContextPayload(BaseModel):
    filename: str
    file_data: str
    namespace: str = "auto"

class RatingPayload(BaseModel):
    context_type: str
    context_id: str
    score: int
    comment: Optional[str] = None

from fastapi import HTTPException

async def processar_sessao_background(session_id: str, modo_input: str, events: list, start_time: int, rag_namespace: str = "auto", video_bytes: bytes = b"", audio_bytes: bytes = b"", roteiro_manual: list = []):
    from api.export_pipeline import renderizar_exportacao
    payload = {
        "session_id": session_id,
        "recording_start_time": start_time,
        "events": events,
        "modo_input": modo_input,
        "rag_namespace": rag_namespace,
        "roteiro_manual": roteiro_manual,
        "video_bytes": video_bytes,
        "audio_bytes": audio_bytes,
    }
    await renderizar_exportacao(payload)

@app.get("/api/v1/rag/namespaces", dependencies=_auth_deps)
async def get_rag_namespaces():
    from api.rag_engine import _load_active_namespaces
    from fastapi.concurrency import run_in_threadpool
    namespaces = await run_in_threadpool(_load_active_namespaces)
    return {"namespaces": namespaces}

@app.post("/api/v1/rag/upload_context", dependencies=_auth_deps)
async def upload_context(payload: UploadContextPayload):
    from api.rag_engine import ingerir_documento_para_namespace
    from fastapi.concurrency import run_in_threadpool
    
    if payload.namespace == "auto":
        payload.namespace = "geral"
        
    sucesso = await run_in_threadpool(
        ingerir_documento_para_namespace,
        payload.file_data, payload.filename, payload.namespace
    )
    if not sucesso:
        raise HTTPException(status_code=500, detail="Falha ao vetorizar documento")
    return {"status": "ok", "message": "Contexto vetorizado com sucesso"}

@app.post("/api/v1/capture/ingest")
async def ingest_capture(
    session_id: str = Form(...),
    recording_start_time: int = Form(0),
    events: str = Form("[]"),
    modo_input: str = Form("A"),
    rag_namespace: str = Form("auto"),
    roteiro_manual: str = Form("[]"),
    detected_interface_type: str = Form("unknown"),
    video: UploadFile = File(...),
    audio: Optional[UploadFile] = File(None),
    user_dict: dict = Depends(require_auth),
):
    """Accept a binary multipart upload for the capture recording."""
    logger.info(f"Recebido payload da sessão: {session_id} do user {user_dict.get('id')}")

    # Cria ou busca a org e inicializa o PipelineRun
    from api.db_services import get_or_create_organization_for_user, create_pipeline_run
    user_id = user_dict.get("id")
    email = user_dict.get("email", "")
    org_id = get_or_create_organization_for_user(user_id, email)
    if org_id:
        create_pipeline_run(session_id, user_id, org_id, detected_interface_type)

    # Validate modo_input (belt-and-suspenders; middleware also checks)
    if modo_input == "C":
        from fastapi import HTTPException
        raise HTTPException(
            status_code=422,
            detail="modo_input='C' (Modo C) is disabled."
        )

    # Parse JSON-encoded form fields
    try:
        events_list = json.loads(events)
    except (json.JSONDecodeError, ValueError):
        events_list = []

    try:
        roteiro_manual_list = json.loads(roteiro_manual)
    except (json.JSONDecodeError, ValueError):
        roteiro_manual_list = []

    # Read the raw video bytes from the uploaded file
    video_bytes = await video.read()

    # Read the optional instructor audio bytes
    audio_bytes = b""
    if audio is not None:
        audio_bytes = await audio.read()

    update_status(session_id, "processing", "Recebendo imagens...")

    # Build the payload dict for the pipeline
    payload_dict = {
        "session_id": session_id,
        "recording_start_time": recording_start_time,
        "events": events_list,
        "video_bytes": video_bytes,
        "audio_bytes": audio_bytes,
        "modo_input": modo_input,
        "roteiro_manual": roteiro_manual_list,
    }

    task = asyncio.create_task(processar_sessao_background(session_id, modo_input, events_list, recording_start_time, rag_namespace, video_bytes, audio_bytes, roteiro_manual_list))
    active_tasks[session_id] = task
    task.add_done_callback(_task_exception_handler)
    task.add_done_callback(lambda t: active_tasks.pop(session_id, None))

    return {"status": "ok", "session_id": session_id}

@app.post("/api/v1/capture/abort/{session_id}")
async def abort_capture(session_id: str):
    logger.info(f"Recebido pedido de abort para sessão: {session_id}")
    # Não sobrescrever se o pipeline já está renderizando ou concluído
    current = get_status(session_id)
    if current.get("status") in ("roteiro_pronto", "rendering_final", "completed"):
        logger.info(f"Abort ignorado — sessão {session_id} já está em '{current.get('status')}'")
        return {"status": "ok", "ignored": True}
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
    def _get_video_url() -> str:
        local_path = f"data/videos_gerados/{session_id}_final.mp4"
        local_url = f"{settings.backend_url}/videos_gerados/{session_id}_final.mp4"
        # Só usa URL do Supabase se o arquivo local NÃO existir (significa que o upload foi bem-sucedido
        # e o arquivo local foi removido, ou que estamos em modo cloud-only).
        # Se o arquivo local existe, serve direto do backend para evitar links quebrados.
        if settings.supabase_url and settings.supabase_key and not os.path.exists(local_path):
            return f"{settings.supabase_url}/storage/v1/object/public/videos/{session_id}_final.mp4"
        return local_url

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
            "url": _get_video_url(),
            "roteiro": roteiro_data
        }
        
    return status_data

@app.get("/api/v1/admin/pipeline-runs", dependencies=_auth_deps)
async def admin_get_pipeline_runs(limit: int = 50, offset: int = 0, status: Optional[str] = None, user_dict: dict = Depends(require_auth)):
    from api.db_services import get_or_create_organization_for_user, get_pipeline_runs_for_organization
    user_id = user_dict.get("id")
    email = user_dict.get("email", "")
    
    org_id = get_or_create_organization_for_user(user_id, email)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organização não encontrada para o usuário.")
        
    return get_pipeline_runs_for_organization(org_id, limit, offset, status)

@app.post("/api/v1/admin/report-error/{session_id}", dependencies=_auth_deps)
async def admin_report_error(session_id: str, payload: dict, user_dict: dict = Depends(require_auth)):
    from api.db_services import update_pipeline_run_status
    update_status(session_id, "user_reported_error", payload.get("message", "Erro reportado pelo usuário"))
    update_pipeline_run_status(session_id, "user_reported_error", "capture")
    return {"status": "ok"}

@app.post("/api/v1/session/{session_id}/publish", dependencies=_auth_deps)
async def track_publish(session_id: str, payload: dict, user_dict: dict = Depends(require_auth)):
    from api.db_services import get_supabase_client
    client = get_supabase_client()
    if not client:
        return {"status": "error", "message": "DB_UNAVAILABLE"}
    try:
        run_res = client.table("pipeline_runs").select("id").eq("session_id", session_id).execute()
        if run_res.data:
            client.table("published_modules").insert({
                "pipeline_run_id": run_res.data[0]["id"],
                "published_by": user_dict.get("id"),
                "destination": payload.get("destination", "SCORM_DOWNLOAD")
            }).execute()
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Erro ao rastrear publicação: {e}")
        return {"status": "error"}

@app.get("/api/v1/admin/metrics", dependencies=_auth_deps)
async def admin_get_metrics(user_dict: dict = Depends(require_auth)):
    from api.db_services import get_or_create_organization_for_user
    from api.metrics_engine import get_organization_metrics
    
    user_id = user_dict.get("id")
    email = user_dict.get("email", "")
    org_id = get_or_create_organization_for_user(user_id, email)
    
    if not org_id:
        raise HTTPException(status_code=403, detail="Organização não encontrada.")
        
    return get_organization_metrics(org_id)

@app.get("/api/v1/admin/publications", dependencies=_auth_deps)
async def admin_get_publications(limit: int = 20, user_dict: dict = Depends(require_auth)):
    """Camada 3.3: Trilha de Publicação e Export."""
    from api.db_services import get_or_create_organization_for_user, get_supabase_client
    client = get_supabase_client()
    if not client:
        return {"publications": []}
        
    user_id = user_dict.get("id")
    org_id = get_or_create_organization_for_user(user_id, user_dict.get("email", ""))
    
    if not org_id:
        raise HTTPException(status_code=403, detail="Organização não encontrada.")
        
    try:
        # Join com pipeline_runs para filtrar por organização
        # No Supabase o join é feito pela relação Foreign Key
        res = client.table("published_modules") \
            .select("id, published_at, destination, published_by, pipeline_runs!inner(session_id, organization_id)") \
            .eq("pipeline_runs.organization_id", org_id) \
            .order("published_at", desc=True) \
            .limit(limit) \
            .execute()
            
        pubs = res.data if res.data else []
        formatted = []
        for p in pubs:
            formatted.append({
                "id": p["id"],
                "published_at": p["published_at"],
                "destination": p["destination"],
                "published_by": p["published_by"],
                "session_id": p["pipeline_runs"]["session_id"] if p.get("pipeline_runs") else "Desconhecido"
            })
        return {"publications": formatted}
    except Exception as e:
        logger.error(f"Erro ao buscar publicações: {e}")
        return {"publications": []}

@app.get("/api/v1/session/{session_id}/roteiro", dependencies=_auth_deps)
async def get_roteiro(session_id: str):
    roteiro_path = f"data/roteiros/{session_id}.json"
    if not os.path.exists(roteiro_path):
        raise HTTPException(status_code=404, detail="Roteiro não encontrado")
    with open(roteiro_path, "r", encoding="utf-8") as f:
        return json.load(f)

@app.post("/api/v1/session/{session_id}/roteiro", dependencies=_auth_deps)
async def save_roteiro(session_id: str, payload: RoteiroEditadoPayload, user_dict: dict = Depends(require_auth)):
    from api.db_services import save_roteiro_version, get_supabase_client
    roteiro_path = f"data/roteiros/{session_id}.json"
    
    existing_data = {}
    is_first_api_save = not os.path.exists(roteiro_path)
    if not is_first_api_save:
        with open(roteiro_path, "r", encoding="utf-8") as f:
            try:
                existing_data = json.load(f)
            except:
                pass
                
    existing_data["session_id"] = session_id
    existing_data["roteiro"] = payload.roteiro
    if payload.titulo:
        existing_data["titulo"] = payload.titulo
    
    with open(roteiro_path, "w", encoding="utf-8") as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)

    # Gap 1: Captura do diff IA vs humano
    roteiro_str = json.dumps(payload.roteiro, ensure_ascii=False)
    user_id = user_dict.get("id")
    
    client = get_supabase_client()
    if client:
        # Verifica se já temos a versão 1 (IA)
        run_res = client.table("pipeline_runs").select("id").eq("session_id", session_id).execute()
        if run_res.data:
            pid = run_res.data[0]["id"]
            vers_res = client.table("roteiro_versoes").select("version").eq("pipeline_run_id", pid).execute()
            existing_versions = [v["version"] for v in vers_res.data]
            
            if 1 not in existing_versions:
                save_roteiro_version(session_id, 1, roteiro_str, user_id)

            if payload.aprovado:
                save_roteiro_version(session_id, 2, roteiro_str, user_id)
        
    if payload.aprovado:
        status_data = get_status(session_id)
        if status_data.get("status") == "rendering_final":
            return {"status": "ok", "message": "Já está renderizando"}
        
        update_status(session_id, "rendering_final", "Renderizando vídeo final com roteiro aprovado...")
        task = asyncio.create_task(
            rerenderizar_com_roteiro_aprovado(session_id, payload.roteiro, payload.usar_overlay, payload.voice_id)
        )
        active_tasks[session_id] = task
        task.add_done_callback(_task_exception_handler)
        task.add_done_callback(lambda t: active_tasks.pop(session_id, None))
        
    return {"status": "ok"}

@app.post("/api/v1/session/{session_id}/passo/{passo_num}/regerar", dependencies=_auth_deps)
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

@app.post("/api/v1/tts/preview", dependencies=_auth_deps)
async def tts_preview(payload: TTSPreviewPayload):
    from video_eng.tts_generator import gerar_audio
    import uuid
    os.makedirs("data/artifacts/previews", exist_ok=True)
    filename = f"preview_{uuid.uuid4().hex}.mp3"
    filepath = f"data/artifacts/previews/{filename}"
    sucesso = await gerar_audio(payload.texto, filepath, payload.voice_id)
    if not sucesso:
        raise HTTPException(status_code=500, detail="Falha ao gerar TTS")
    
    base = settings.backend_url
    url = f"{base}/artifacts/previews/{filename}"
    return {"audio_url": url}

@app.get("/api/v1/session/{session_id}/artifacts", dependencies=_auth_deps)
async def get_artifacts(session_id: str):
    """Retorna URLs de todos os artefatos gerados para uma sessão."""
    base = settings.backend_url
    art_dir = f"data/artifacts/{session_id}"
    sim_dir = f"data/simlink"

    def url_if_exists(local_path: str, public_url: str) -> str | None:
        return public_url if os.path.exists(local_path) else None

    def _get_video_url() -> str:
        local_path = f"data/videos_gerados/{session_id}_final.mp4"
        local_url = f"{settings.backend_url}/videos_gerados/{session_id}_final.mp4"
        if settings.supabase_url and settings.supabase_key and not os.path.exists(local_path):
            return f"{settings.supabase_url}/storage/v1/object/public/videos/{session_id}_final.mp4"
        return local_url

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
        "video_url":       url_if_exists(f"data/videos_gerados/{session_id}_final.mp4", _get_video_url()),
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

@app.get("/api/v1/simlink/{modulo_id}", dependencies=_auth_deps)
async def get_simlink_modulo(modulo_id: str):
    # Procura pelo módulo — offloaded to a thread so the event loop is not blocked
    import glob

    def _find_module() -> dict | None:
        for filepath in glob.glob("data/simlink/*.json"):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    mod = json.load(f)
                    if mod.get("modulo_id") == modulo_id:
                        return mod
            except Exception:
                pass
        return None

    mod = await asyncio.to_thread(_find_module)
    if mod is None:
        raise HTTPException(status_code=404, detail="Módulo Simlink não encontrado")
    return mod


@app.get("/api/v1/roteiros", dependencies=_auth_deps)
async def listar_roteiros(limit: int = 0, offset: int = 0):
    """Lista roteiros salvos com metadados básicos para a aba Roteiros da extensão.

    Returns session_id, número de passos, status atual, e data de modificação.
    Ordenados do mais recente ao mais antigo.
    """
    import glob

    def _load_roteiros() -> list:
        result = []
        for filepath in glob.glob("data/roteiros/*.json"):
            # Ignorar .jsonl
            if filepath.endswith(".jsonl"):
                continue
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)

                session_id = data.get("session_id", "")
                roteiro = data.get("roteiro", [])

                # Derivar título do primeiro passo com âncora ou intenção
                titulo = data.get("titulo", "")
                if not titulo:
                    for p in roteiro:
                        if str(p.get("passo", 0)) in ("0", "999"):
                            continue
                        ancora = p.get("ancora", "").strip()
                        if ancora:
                            titulo = ancora
                            break
                        intencao = p.get("intencao_original", "").strip()
                        if intencao and not titulo:
                            titulo = intencao
                    if not titulo:
                        titulo = f"Sessão {session_id[-8:]}" if session_id else "Sem título"

                # Buscar status atual
                status_data = get_status(session_id)
                status = status_data.get("status", "unknown")

                # Data de modificação do arquivo
                import pathlib
                mtime = pathlib.Path(filepath).stat().st_mtime
                from datetime import datetime
                criado_em = datetime.fromtimestamp(mtime).isoformat()

                # Contar passos reais (excluindo 0 e 999)
                passos_reais = [p for p in roteiro if p.get("passo", 0) not in (0, 999)]

                result.append({
                    "session_id": session_id,
                    "titulo": titulo,
                    "total_passos": len(passos_reais),
                    "status": status,
                    "criado_em": criado_em,
                })
            except Exception as e:
                logger.warning(f"Erro ao ler roteiro {filepath}: {e}")

        # Mais recente primeiro
        result.sort(key=lambda r: r.get("criado_em", ""), reverse=True)
        return result

    roteiros = await asyncio.to_thread(_load_roteiros)
    total = len(roteiros)

    if limit > 0:
        roteiros = roteiros[offset: offset + limit]
    elif offset > 0:
        roteiros = roteiros[offset:]

    return {"roteiros": roteiros, "total": total, "count": len(roteiros), "offset": offset, "limit": limit}


@app.delete("/api/v1/roteiros/{session_id}", dependencies=_auth_deps)
async def excluir_roteiro(session_id: str):
    """Remove um roteiro e seus artefatos associados (vídeo, áudios, PDF, etc)."""
    import shutil

    removidos = []

    # Roteiro JSON/JSONL
    for ext in (".json", ".jsonl"):
        path = f"data/roteiros/{session_id}{ext}"
        if os.path.exists(path):
            os.remove(path)
            removidos.append(path)

    # Status
    status_path = f"data/status/{session_id}.json"
    if os.path.exists(status_path):
        os.remove(status_path)
        removidos.append(status_path)

    # Vídeo final
    video_path = f"data/videos_gerados/{session_id}_final.mp4"
    if os.path.exists(video_path):
        os.remove(video_path)
        removidos.append(video_path)

    # Vídeo raw
    raw_path = f"data/raw_videos/{session_id}_raw.webm"
    if os.path.exists(raw_path):
        os.remove(raw_path)
        removidos.append(raw_path)

    # Áudios
    audios_dir = f"data/audios/{session_id}"
    if os.path.isdir(audios_dir):
        shutil.rmtree(audios_dir)
        removidos.append(audios_dir)

    # Artefatos (PDF, transcrição, quiz)
    artifacts_dir = f"data/artifacts/{session_id}"
    if os.path.isdir(artifacts_dir):
        shutil.rmtree(artifacts_dir)
        removidos.append(artifacts_dir)

    # Simlink módulo
    simlink_path = f"data/simlink/{session_id}.json"
    if os.path.exists(simlink_path):
        os.remove(simlink_path)
        removidos.append(simlink_path)

    # SCORM
    scorm_path = f"data/scorm/{session_id}.zip"
    if os.path.exists(scorm_path):
        os.remove(scorm_path)
        removidos.append(scorm_path)

    logger.info(f"Roteiro {session_id} excluído. Arquivos removidos: {len(removidos)}")
    return {"status": "ok", "removidos": len(removidos)}


@app.get("/api/v1/modulos", dependencies=_auth_deps)
async def listar_modulos(dominio: str = "", limit: int = 0, offset: int = 0):
    """
    Lista módulos Simlink disponíveis, filtrados opcionalmente por domínio.
    Usado pelo popup para descobrir módulos disponíveis para a aba atual.

    Supports pagination via ``limit`` / ``offset`` query parameters.
    ``limit=0`` (default) returns all matching modules (no cap).
    The ordering is always newest-first (``criado_em`` descending).
    Response includes ``total`` (count before pagination) and ``count``
    (items in this page) for caller convenience.
    """
    import glob

    def _load_modules() -> list:
        result = []
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

                result.append({
                    "modulo_id":    mod.get("modulo_id"),
                    "titulo":       mod.get("titulo"),
                    "total_passos": mod.get("total_passos"),
                    "xp_max":       mod.get("xp_max"),
                    "dominio":      mod_dominio,
                    "criado_em":    mod.get("criado_em"),
                    "session_id":   mod.get("session_id"),
                })
            except Exception as e:
                logger.warning(f"Erro ao ler módulo {filepath}: {e}")

        # Ordenar por data de criação (mais recente primeiro)
        result.sort(key=lambda m: m.get("criado_em", ""), reverse=True)
        return result

    modulos = await asyncio.to_thread(_load_modules)
    total = len(modulos)

    # Apply pagination when limit is given (limit=0 means "no cap")
    if limit > 0:
        modulos = modulos[offset: offset + limit]
    elif offset > 0:
        modulos = modulos[offset:]

    return {"modulos": modulos, "total": total, "count": len(modulos), "offset": offset, "limit": limit}

@app.post("/api/v1/simlink/{modulo_id}/conclusao", dependencies=_auth_deps)
async def registrar_conclusao_simlink(modulo_id: str, payload: dict):
    # Busca módulo e dispara callback LMS se necessário — offloaded so the event loop is not blocked
    import glob
    from simlink_eng.lms_callback import reportar_conclusao_lms

    modulo_path = f"data/simlink/{modulo_id}_resultado.json"

    def _write_and_find_module() -> dict | None:
        with open(modulo_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        for filepath in glob.glob("data/simlink/*.json"):
            if not filepath.endswith("_resultado.json"):
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        mod = json.load(f)
                        if mod.get("modulo_id") == modulo_id and mod.get("lms_callback_url"):
                            return mod
                except Exception:
                    pass
        return None

    mod = await asyncio.to_thread(_write_and_find_module)
    if mod is not None:
        asyncio.create_task(reportar_conclusao_lms(
            mod["lms_callback_url"],
            mod.get("lms_callback_token", ""),
            modulo_id,
            payload.get("xp", 0),
            mod.get("xp_max", 0),
            payload.get("completado", True),
        ))
    return {"status": "ok"}

@app.post("/api/v1/session/{session_id}/simlink/configure", dependencies=_auth_deps)
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

@app.post("/api/v1/ratings")
async def submit_rating(payload: RatingPayload, request: Request):
    """Salva uma avaliação (NPS/CSAT) no Supabase."""
    if not settings.supabase_url or not settings.supabase_key:
        logger.warning("Supabase não configurado. Avaliação ignorada.")
        return {"status": "ignored"}
    
    # Extrair user_id do token se disponível. O AuthMiddleware deve colocar em request.state
    # Se o sistema atual apenas tem uma proteção fraca ou admin único, podemos precisar
    # usar um fallback ou o UID padrão da plataforma.
    user_id = getattr(request.state, 'user_id', None)
    
    # Se não houver user_id explícito na requisição, usamos um namespace dummy ou UUID fixo 
    # para fins de tracking (já que é uma feature inicial).
    if not user_id:
        # Fallback UUID for single-user desktop version or unauthenticated SCORM flows
        user_id = "00000000-0000-0000-0000-000000000000"

    try:
        from supabase import create_client, Client
        supabase: Client = create_client(settings.supabase_url, settings.supabase_key)
        
        data = {
            "user_id": user_id,
            "context_type": payload.context_type,
            "context_id": payload.context_id,
            "score": payload.score,
            "comment": payload.comment
        }
        
        # O supabase-py tem .upsert(), útil pela constraint UNIQUE(user_id, context_type, context_id)
        response = supabase.table('ratings').upsert(data).execute()
        return {"status": "ok", "data": response.data}
    except Exception as e:
        logger.error(f"Erro ao salvar rating no Supabase: {e}")
        raise HTTPException(status_code=500, detail="Erro interno ao processar avaliação")

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

@app.post("/api/v1/sandbox/evaluate", dependencies=_auth_deps)
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

@app.post("/api/v1/session/{session_id}/scorm/rebuild", dependencies=_auth_deps)
async def rebuild_scorm(session_id: str):
    """Regenera o pacote SCORM para uma sessão já processada, sem re-renderizar o vídeo.

    Útil para aplicar atualizações dos templates (try-player.js, index.html)
    a SCORMs já gerados. Inclui quiz automaticamente se quiz.json existir.
    """
    simlink_path = f"data/simlink/{session_id}.json"
    if not os.path.exists(simlink_path):
        raise HTTPException(status_code=404, detail="Módulo Simlink não encontrado para esta sessão")

    import json as _json
    from contracts.simlink_models import SimlinkModulo
    from scorm_eng.scorm_builder import gerar_scorm

    with open(simlink_path, "r", encoding="utf-8") as f:
        mod_data = _json.load(f)

    try:
        simlink_modulo = SimlinkModulo(**mod_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao carregar módulo Simlink: {e}")

    # Backfill intro audio if not yet in the stored simlink
    if not simlink_modulo.intro_audio_filename:
        intro_path = f"data/audios/{session_id}/passo_1_final.mp3"
        if os.path.exists(intro_path):
            simlink_modulo.intro_audio_filename = os.path.basename(intro_path)

    titulo = mod_data.get("titulo", f"Tutorial — Sessão {session_id}")

    # Incluir quiz se já foi gerado
    quiz_path = f"data/artifacts/{session_id}/quiz.json"
    incluir_quiz = os.path.exists(quiz_path) and os.path.getsize(quiz_path) > 10

    scorm_path = await gerar_scorm(
        simlink_modulo,
        session_id,
        titulo,
        incluir_quiz=incluir_quiz,
        quiz_data_path=quiz_path if incluir_quiz else None
    )
    logger.info(f"SCORM regenerado em: {scorm_path} (quiz={'sim' if incluir_quiz else 'não'})")

    return {
        "status": "ok",
        "quiz_incluido": incluir_quiz,
        "scorm_download_url": f"{settings.backend_url}/scorm/{session_id}.zip"
    }


@app.post("/api/v1/sandbox/reset", dependencies=_auth_deps)
async def reset_sandbox(payload: dict):
    """Reseta o estado do sandbox para uma sessão (usado ao iniciar nova prática)."""
    session_id = payload.get("session_id", "")
    if session_id:
        path = f"data/status/sandbox_{session_id}.json"
        if os.path.exists(path):
            os.remove(path)
    return {"status": "ok"}
