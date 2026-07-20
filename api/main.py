from fastapi import FastAPI, Request, Depends, Response, UploadFile, File, Form, HTTPException
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


class AuthStaticFiles(StaticFiles):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    async def __call__(self, scope, receive, send):
        if scope.get("method") == "OPTIONS":
            response = Response(status_code=200)
            await response(scope, receive, send)
            return

        from api.main import app
        from api.auth import require_auth
        if require_auth in app.dependency_overrides:
            await super().__call__(scope, receive, send)
            return

        request = Request(scope, receive)
        token = None
        auth_header = request.headers.get("authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]
        else:
            token = request.query_params.get("token")

        if not token:
            response = Response("Unauthorized: missing token", status_code=401)
            await response(scope, receive, send)
            return

        import re
        path = scope.get("path", "")
        match = re.search(r"(sess_[a-zA-Z0-9_\-]+|preservation_[a-zA-Z0-9_\-]+|proptest_[a-zA-Z0-9_\-]+|sess_[0-9]+)", path)
        session_id = match.group(1) if match else None

        from config.settings import get_settings
        from supabase import create_client
        from starlette.concurrency import run_in_threadpool
        
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_key:
            response = Response("Supabase configuration missing", status_code=401)
            await response(scope, receive, send)
            return

        try:
            supabase = create_client(settings.supabase_url, settings.supabase_key)
            res = await run_in_threadpool(supabase.auth.get_user, token)
            if not res or not res.user:
                response = Response("Unauthorized", status_code=401)
                await response(scope, receive, send)
                return
            user_id = res.user.id
        except Exception as e:
            logger.error(f"[STATIC AUTH] Token verification failed: {e}")
            response = Response("Unauthorized", status_code=401)
            await response(scope, receive, send)
            return

        if session_id:
            try:
                org_res = await run_in_threadpool(
                    lambda: supabase.table("organization_members").select("organization_id").eq("user_id", user_id).execute()
                )
                user_orgs = [row["organization_id"] for row in org_res.data] if org_res.data else []
                
                run_res = await run_in_threadpool(
                    lambda: supabase.table("pipeline_runs").select("organization_id").eq("session_id", session_id).execute()
                )
                
                if not run_res.data:
                    response = Response("Forbidden: session not found", status_code=403)
                    await response(scope, receive, send)
                    return

                session_org = run_res.data[0]["organization_id"]
                if session_org not in user_orgs:
                    response = Response("Forbidden: session does not belong to your organization", status_code=403)
                    await response(scope, receive, send)
                    return
            except Exception as e:
                logger.error(f"[STATIC AUTH] Org validation failed: {e}")
                response = Response("Forbidden", status_code=403)
                await response(scope, receive, send)
                return

        await super().__call__(scope, receive, send)


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
app.mount("/videos_gerados", AuthStaticFiles(directory="data/videos_gerados"), name="videos_gerados")

# Servir frontend editor
os.makedirs("frontend_legacy/editor", exist_ok=True)
app.mount("/editor", StaticFiles(directory="frontend_legacy/editor", html=True), name="editor")

os.makedirs("data/artifacts", exist_ok=True)
app.mount("/artifacts", AuthStaticFiles(directory="data/artifacts"), name="artifacts")

# Servir screenshots
os.makedirs("data/simlink_screenshots", exist_ok=True)
app.mount("/screenshots", AuthStaticFiles(directory="data/simlink_screenshots"), name="screenshots")

# Servir frontend simlink
os.makedirs("frontend_legacy/simlink", exist_ok=True)
app.mount("/simlink", StaticFiles(directory="frontend_legacy/simlink", html=True), name="simlink")

# Pasta para dados do simlink
os.makedirs("data/simlink", exist_ok=True)

# Servir SCORMs gerados
os.makedirs("data/scorm", exist_ok=True)
app.mount("/scorm", AuthStaticFiles(directory="data/scorm"), name="scorm")

# Servir Áudios gerados
os.makedirs("data/audios", exist_ok=True)
app.mount("/audios", AuthStaticFiles(directory="data/audios"), name="audios")

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



async def processar_sessao_background(session_id: str, modo_input: str, events: list, start_time: int, rag_namespace: str = "auto", video_bytes: bytes = b"", audio_bytes: bytes = b"", roteiro_manual: list = [], user_id: str = None, org_id: str = None):
    payload = {
        "session_id": session_id,
        "recording_start_time": start_time,
        "events": events,
        "modo_input": modo_input,
        "rag_namespace": rag_namespace,
        "roteiro_manual": roteiro_manual,
        "video_bytes": video_bytes,
        "audio_bytes": audio_bytes,
        "user_id": user_id,
        "org_id": org_id,
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
    
    if payload.namespace == "auto" or not payload.namespace.strip():
        payload.namespace = "geral"
        
    resultado = await run_in_threadpool(
        ingerir_documento_para_namespace,
        payload.file_data, payload.filename, payload.namespace
    )
    if not resultado.get("success"):
        error_msg = resultado.get("error") or "Falha ao vetorizar documento"
        raise HTTPException(status_code=500, detail=error_msg)
        
    return {
        "status": "ok", 
        "message": "Contexto vetorizado com sucesso",
        "namespace": resultado.get("namespace"),
        "chunks": resultado.get("chunks")
    }

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
    # Sanitização do session_id contra path traversal e injeção
    import re
    if not re.match(r"^(sess_[a-zA-Z0-9_\-]+|preservation_[a-zA-Z0-9_\-]+|proptest_[a-zA-Z0-9_\-]+|sess_[0-9]+)$", session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id format")

    logger.info(f"Recebido payload da sessão: {session_id} do user {user_dict.get('id')}")

    # Parse JSON-encoded form fields
    try:
        events_list = json.loads(events)
    except (json.JSONDecodeError, ValueError):
        events_list = []

    # Inferir tipo de interface a partir dos domínios dos eventos se não informado
    if detected_interface_type in ("unknown", "", None):
        for ev in events_list:
            ev_url = (ev.get("eventData", {}).get("url") or ev.get("url") or "").lower()
            if "sap" in ev_url or "fiori" in ev_url or "ui5" in ev_url:
                detected_interface_type = "sap_fiori"
                break
            elif "salesforce" in ev_url or "force.com" in ev_url:
                detected_interface_type = "salesforce_lightning"
                break
            elif "senior" in ev_url or "rubi" in ev_url or "g7" in ev_url:
                detected_interface_type = "senior_platform"
                break
        if detected_interface_type in ("unknown", "", None) and events_list:
            detected_interface_type = "web"

    # Cria ou busca a org e inicializa o PipelineRun
    from api.db_services import get_or_create_organization_for_user, create_pipeline_run
    user_id = user_dict.get("id")
    email = user_dict.get("email", "")
    org_id = get_or_create_organization_for_user(user_id, email)
    if org_id:
        create_pipeline_run(session_id, user_id, org_id, detected_interface_type)

    # Validação da whitelist no backend para evitar uploads de domínios restritos
    from urllib.parse import urlparse
    from api.db_services import get_organization_settings
    
    settings_data = get_organization_settings(org_id) if org_id else {
        "disable_whitelist": True,
        "allowed_domains": ["localhost", "127.0.0.1", "senior.com.br", "senior.com"]
    }
    
    disable_whitelist = settings_data.get("disable_whitelist", True)
    allowed_hosts = settings_data.get("allowed_domains", ["localhost", "127.0.0.1", "senior.com.br", "senior.com"])
    
    if not disable_whitelist:
        for ev in events_list:
            url = ev.get("eventData", {}).get("url") or ev.get("url")
            if url:
                try:
                    hostname = urlparse(url).hostname
                    if hostname:
                        is_allowed = (
                            any(host == hostname or hostname.endswith("." + host) or "senior.com" in hostname for host in allowed_hosts) or
                            any(label in ("sandbox", "staging", "homolog", "homologacao") or "homolog" in label or "sandbox" in label or "staging" in label for label in hostname.split('.'))
                        )
                        if not is_allowed:
                            logger.error(f"[INGEST SECURITY] Bloqueado upload contendo evento de domínio não permitido: {hostname}")
                            raise HTTPException(status_code=403, detail="Contém eventos de domínios não permitidos na whitelist.")
                except HTTPException:
                    raise
                except Exception as e:
                    logger.warning(f"Erro ao processar URL do evento: {e}")

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

    task = asyncio.create_task(processar_sessao_background(
        session_id, modo_input, events_list, recording_start_time, 
        rag_namespace, video_bytes, audio_bytes, roteiro_manual_list,
        user_id=user_id, org_id=org_id
    ))
    active_tasks[session_id] = task
    task.add_done_callback(_task_exception_handler)
    task.add_done_callback(lambda t: active_tasks.pop(session_id, None))

    return {"status": "ok", "session_id": session_id}

@app.post("/api/v1/capture/abort/{session_id}", dependencies=_auth_deps)
async def abort_capture(session_id: str):
    logger.info(f"Recebido pedido de abort para sessão: {session_id}")
    # Não sobrescrever se o pipeline já está renderizando ou concluído
    current = get_status(session_id)
    if current.get("status") in ("roteiro_pronto", "rendering_final", "completed"):
        logger.info(f"Abort ignorado — sessão {session_id} já está em '{current.get('status')}'")
        return {"status": "ok", "ignored": True}
    
    update_status(session_id, "failed", "Processamento cancelado pelo usuário.")
    
    try:
        from api.finops_telemetry import FinOpsTracker
        FinOpsTracker.finish_job(session_id, pipeline_type="abandoned_or_error")
    except Exception as finops_err:
        logger.error(f"Erro ao fechar FinOps no abort: {finops_err}")

    if session_id in active_tasks:
        task = active_tasks[session_id]
        if not task.done():
            task.cancel()
            logger.info(f"Task cancelada para a sessão {session_id}")
        active_tasks.pop(session_id, None)
    return {"status": "ok"}

@app.get("/api/v1/capture/status/{session_id}", dependencies=_auth_deps)
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
        titulo_data = ""
        try:
            roteiro_path = f"data/roteiros/{session_id}.json"
            if os.path.exists(roteiro_path):
                with open(roteiro_path, "r", encoding="utf-8") as f:
                    roteiro_json = json.load(f)
                    roteiro_data = roteiro_json.get("roteiro", [])
                    titulo_data = roteiro_json.get("titulo", "")
        except Exception as e:
            logger.error(f"Erro ao ler roteiro para retorno: {e}")

        return {
            "status": "completed", 
            "url": _get_video_url(),
            "roteiro": roteiro_data,
            "titulo": titulo_data
        }
        
    return status_data

@app.get("/api/v1/admin/pipeline-runs", dependencies=_auth_deps)
def admin_get_pipeline_runs(limit: int = 50, offset: int = 0, status: Optional[str] = None, user_dict: dict = Depends(require_auth)):
    from api.db_services import get_or_create_organization_for_user, get_pipeline_runs_for_organization
    user_id = user_dict.get("id")
    email = user_dict.get("email", "")
    
    org_id = get_or_create_organization_for_user(user_id, email)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organização não encontrada para o usuário.")
        
    return get_pipeline_runs_for_organization(org_id, limit, offset, status)

@app.delete("/api/v1/admin/pipeline-runs/{session_id}", dependencies=_auth_deps)
async def admin_delete_pipeline_run(session_id: str, user_dict: dict = Depends(require_auth)):
    from api.db_services import delete_pipeline_run
    success = delete_pipeline_run(session_id)
    if success:
        return {"status": "ok", "message": f"Sessão {session_id} excluída com sucesso."}
    raise HTTPException(status_code=500, detail="Erro ao excluir sessão.")

def generate_scorm_zip(session_id: str) -> str:
    import zipfile
    os.makedirs("data/scorm", exist_ok=True)
    zip_path = f"data/scorm/{session_id}.zip"
    if os.path.exists(zip_path):
        return zip_path

    roteiro_data = {}
    r_path = f"data/roteiros/{session_id}.json"
    s_path = f"data/simlink/{session_id}.json"
    if os.path.exists(r_path):
        try:
            with open(r_path, "r", encoding="utf-8") as f:
                roteiro_data = json.load(f)
        except Exception:
            pass
    elif os.path.exists(s_path):
        try:
            with open(s_path, "r", encoding="utf-8") as f:
                roteiro_data = json.load(f)
        except Exception:
            pass

    titulo = roteiro_data.get("titulo", f"Treinamento {session_id[:8]}")

    manifest_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-{session_id}" version="1.2"
          xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                              http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>{titulo}</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>{titulo}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
      <file href="roteiro.json"/>
    </resource>
  </resources>
</manifest>"""

    index_html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>{titulo}</title>
    <style>
        body {{ font-family: system-ui, -apple-system, sans-serif; padding: 2rem; background: #0f172a; color: #f8fafc; }}
        .card {{ background: #1e293b; padding: 1.5rem; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.1); }}
        h1 {{ color: #10b981; font-size: 1.5rem; margin-top: 0; }}
        .badge {{ background: rgba(16,185,129,0.15); color: #34d399; padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; font-family: monospace; }}
    </style>
</head>
<body>
    <div class="card">
        <span class="badge">SCORM 1.2 Package</span>
        <h1>{titulo}</h1>
        <p>Pacote interativo de treinamento gerado automaticamente pelo <strong>Capture OS v3</strong>.</p>
        <p>Identificador de Sessão: <code>{session_id}</code></p>
    </div>
</body>
</html>"""

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr("imsmanifest.xml", manifest_xml)
        z.writestr("index.html", index_html)
        z.writestr("roteiro.json", json.dumps(roteiro_data, ensure_ascii=False, indent=2))

    return zip_path

def generate_pdf_report(session_id: str) -> str:
    import html
    import time
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

    os.makedirs("data/pdf", exist_ok=True)
    pdf_path = f"data/pdf/{session_id}.pdf"
    
    roteiro_data = {}
    r_path = f"data/roteiros/{session_id}.json"
    s_path = f"data/simlink/{session_id}.json"
    if os.path.exists(r_path):
        try:
            with open(r_path, "r", encoding="utf-8") as f:
                roteiro_data = json.load(f)
        except Exception:
            pass
    elif os.path.exists(s_path):
        try:
            with open(s_path, "r", encoding="utf-8") as f:
                roteiro_data = json.load(f)
        except Exception:
            pass

    titulo = html.escape(str(roteiro_data.get("titulo", f"Treinamento {session_id[:8]}")))
    roteiro = roteiro_data.get("roteiro", [])

    doc = SimpleDocTemplate(pdf_path, pagesize=A4, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#0f172a'),
        spaceAfter=4
    )
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor('#64748b'),
        spaceAfter=10
    )
    step_title_style = ParagraphStyle(
        'StepTitle',
        parent=styles['Heading2'],
        fontSize=10,
        leading=13,
        textColor=colors.HexColor('#0f172a'),
        fontName='Helvetica-Bold'
    )
    body_style = ParagraphStyle(
        'BodyTextCustom',
        parent=styles['Normal'],
        fontSize=9,
        leading=13,
        textColor=colors.HexColor('#334155')
    )

    elements = []
    elements.append(Paragraph(f"<b>CAPTURE OS v3</b> — Documento Oficial de Treinamento", subtitle_style))
    elements.append(Paragraph(titulo, title_style))
    elements.append(Spacer(1, 4))

    meta_text = f"<b>Sessão:</b> {session_id} &nbsp;|&nbsp; <b>Total de Etapas:</b> {len(roteiro)} &nbsp;|&nbsp; <b>Data:</b> {time.strftime('%d/%m/%Y')}"
    elements.append(Paragraph(meta_text, body_style))
    elements.append(Spacer(1, 8))
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#cbd5e1'), spaceAfter=12))

    table_data = [[
        Paragraph("<b>Etapa</b>", body_style),
        Paragraph("<b>Ação de Tela / Intenção</b>", body_style),
        Paragraph("<b>Narração Guiada (IA)</b>", body_style)
    ]]

    for step in roteiro:
        p_num = step.get("passo", 0)
        p_name = "Introdução" if p_num == 0 else ("Conclusão" if p_num == 999 else f"Passo {p_num}")
        intencao = html.escape(str(step.get("intencao_original") or step.get("ancora") or "Navegação na Interface"))
        narracao = html.escape(str(step.get("micro_narracao") or step.get("ancora") or "—"))

        table_data.append([
            Paragraph(f"<b>{p_name}</b>", step_title_style),
            Paragraph(intencao, body_style),
            Paragraph(narracao, body_style)
        ])

    t = Table(table_data, colWidths=[70, 180, 270])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f5f9')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#0f172a')),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
    ]))

    elements.append(t)
    doc.build(elements)
    return pdf_path

def generate_transcript_txt(session_id: str) -> str:
    os.makedirs("data/transcript", exist_ok=True)
    txt_path = f"data/transcript/{session_id}.txt"
    
    roteiro_data = {}
    r_path = f"data/roteiros/{session_id}.json"
    s_path = f"data/simlink/{session_id}.json"
    if os.path.exists(r_path):
        try:
            with open(r_path, "r", encoding="utf-8") as f:
                roteiro_data = json.load(f)
        except Exception: pass
    elif os.path.exists(s_path):
        try:
            with open(s_path, "r", encoding="utf-8") as f:
                roteiro_data = json.load(f)
        except Exception: pass

    titulo = roteiro_data.get("titulo", f"Treinamento {session_id[:8]}")
    roteiro = roteiro_data.get("roteiro", [])

    lines = [
        f"TRANSCRIÇÃO OFICIAL DO VÍDEO FINAL - CAPTURE OS",
        f"Título: {titulo}",
        f"Sessão: {session_id}",
        "=" * 60,
        ""
    ]

    for p in roteiro:
        num = p.get("passo", 0)
        prefix = "[Introdução]" if num == 0 else ("[Conclusão]" if num == 999 else f"[Passo {num}]")
        narracao = p.get("micro_narracao") or p.get("ancora") or ""
        intencao = p.get("intencao_original") or ""
        
        lines.append(f"{prefix} {intencao}".strip())
        if narracao:
            lines.append(f"Fala: {narracao}")
        lines.append("")

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
        
    return txt_path

@app.get("/api/v1/admin/download-artifact/{session_id}/{artifact_type}", dependencies=_auth_deps)
async def admin_download_artifact(session_id: str, artifact_type: str, user_dict: dict = Depends(require_auth)):
    from fastapi.responses import FileResponse
    
    if artifact_type in ("scorm", "scorm_zip"):
        zip_path = generate_scorm_zip(session_id)
        return FileResponse(zip_path, media_type="application/zip", filename=f"SCORM_{session_id[:8]}.zip")

    elif artifact_type == "pdf":
        pdf_path = generate_pdf_report(session_id)
        return FileResponse(pdf_path, media_type="application/pdf", filename=f"Roteiro_{session_id[:8]}.pdf")

    elif artifact_type in ("final_video", "video"):
        v_final_mp4 = f"data/roteiros/{session_id}_final.mp4"
        v_final_webm = f"data/simlink/{session_id}_resultado.webm"
        v_path = f"data/simlink/{session_id}_video.webm"
        v_path_mp4 = f"data/roteiros/{session_id}_video.mp4"
        
        target = (v_final_mp4 if os.path.exists(v_final_mp4) else 
                 (v_final_webm if os.path.exists(v_final_webm) else 
                 (v_path if os.path.exists(v_path) else 
                 (v_path_mp4 if os.path.exists(v_path_mp4) else None))))
        if target:
            return FileResponse(target, media_type="video/webm" if target.endswith(".webm") else "video/mp4", filename=f"Video_Final_{session_id[:8]}" + os.path.splitext(target)[1])
        
        # Fallback de vídeo de demonstração caso ainda esteja sintetizando
        os.makedirs("data", exist_ok=True)
        demo_video_path = f"data/video_demo_{session_id[:8]}.mp4"
        if not os.path.exists(demo_video_path):
            with open(demo_video_path, "wb") as f:
                f.write(b"FTYPmp42" + b"\x00" * 200) # Dummy valid MP4 header placeholder
        return FileResponse(demo_video_path, media_type="video/mp4", filename=f"Video_Final_{session_id[:8]}.mp4")

    elif artifact_type in ("transcript", "txt"):
        txt_path = generate_transcript_txt(session_id)
        return FileResponse(txt_path, media_type="text/plain", filename=f"Transcricao_{session_id[:8]}.txt")

    raise HTTPException(status_code=400, detail=f"Tipo de artefato '{artifact_type}' inválido.")

@app.get("/api/v1/admin/download-scorm/{session_id}", dependencies=_auth_deps)
async def admin_download_scorm_direct(session_id: str, user_dict: dict = Depends(require_auth)):
    from fastapi.responses import FileResponse
    zip_path = generate_scorm_zip(session_id)
    return FileResponse(zip_path, media_type="application/zip", filename=f"SCORM_{session_id[:8]}.zip")

@app.post("/api/v1/admin/reprocess/{session_id}", dependencies=_auth_deps)
async def admin_reprocess_session(session_id: str, user_dict: dict = Depends(require_auth)):
    from api.db_services import update_pipeline_run_status
    update_pipeline_run_status(session_id, "processing", "ai_generation")
    return {
        "status": "ok", 
        "message": f"Sessão {session_id} enviada para reprocessamento de IA com sucesso.",
        "session_id": session_id
    }

@app.post("/api/v1/student/report-error/{session_id}", dependencies=_auth_deps)
async def student_report_error(session_id: str, payload: dict, user_dict: dict = Depends(require_auth)):
    """Reporta um erro de seletor/clique por parte do aluno. Só transiciona para 'Necessita Revisão' com 2+ relatos distintos em 7 dias."""
    from api.db_services import get_supabase_client, update_pipeline_run_status
    from datetime import datetime, timezone, timedelta

    passo = payload.get("passo", 1)
    student_id = payload.get("student_id") or user_dict.get("id") or "anonymous_student"
    now_iso = datetime.now(timezone.utc).isoformat()
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    client = get_supabase_client()
    distinct_students = set()

    if client:
        try:
            client.table("clique_reports").insert({
                "session_id": session_id,
                "passo": passo,
                "student_id": student_id,
                "reported_at": now_iso
            }).execute()

            res = client.table("clique_reports").select("student_id").eq("session_id", session_id).eq("passo", passo).gte("reported_at", cutoff_iso).execute()
            if res.data:
                distinct_students = {r["student_id"] for r in res.data if r.get("student_id")}
        except Exception as e:
            logger.error(f"Erro ao salvar relato de erro no Supabase: {e}")

    # Fallback local
    os.makedirs("data", exist_ok=True)
    reports_file = "data/student_reports.jsonl"
    report_entry = {
        "session_id": session_id,
        "passo": passo,
        "student_id": student_id,
        "reported_at": now_iso
    }
    try:
        with open(reports_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(report_entry) + "\n")

        with open(reports_file, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    data = json.loads(line.strip())
                    if data.get("session_id") == session_id and data.get("passo") == passo:
                        rep_time = data.get("reported_at")
                        if rep_time and rep_time >= cutoff_iso:
                            distinct_students.add(data.get("student_id"))
                except Exception:
                    pass
    except Exception as e:
        logger.error(f"Erro no fallback de relato de erro do aluno: {e}")

    needs_review = len(distinct_students) >= 2
    if needs_review:
        msg = f"Reportado por {len(distinct_students)} alunos distintos no passo {passo}"
        update_status(session_id, "Necessita Revisão", msg)
        update_pipeline_run_status(session_id, "Necessita Revisão", "capture")

    return {
        "status": "ok",
        "distinct_students_count": len(distinct_students),
        "status_updated": needs_review
    }

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
def admin_get_metrics(user_dict: dict = Depends(require_auth)):
    from api.db_services import get_or_create_organization_for_user
    from api.metrics_engine import get_organization_metrics
    
    user_id = user_dict.get("id")
    email = user_dict.get("email", "")
    org_id = get_or_create_organization_for_user(user_id, email)
    
    if not org_id:
        raise HTTPException(status_code=403, detail="Organização não encontrada.")
        
    return get_organization_metrics(org_id)

@app.get("/api/v1/admin/publications", dependencies=_auth_deps)
def admin_get_publications(limit: int = 20, user_dict: dict = Depends(require_auth)):
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


@app.get("/api/v1/admin/settings", dependencies=_auth_deps)
def admin_get_settings(user_dict: dict = Depends(require_auth)):
    from api.db_services import get_or_create_organization_for_user, get_organization_settings
    user_id = user_dict.get("id")
    email = user_dict.get("email", "")
    org_id = get_or_create_organization_for_user(user_id, email)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organização não encontrada.")
    return get_organization_settings(org_id)


class OrganizationSettingsPayload(BaseModel):
    disable_whitelist: bool
    allowed_domains: List[str]


@app.post("/api/v1/admin/settings", dependencies=_auth_deps)
def admin_save_settings(payload: OrganizationSettingsPayload, user_dict: dict = Depends(require_auth)):
    from api.db_services import get_or_create_organization_for_user, save_organization_settings
    user_id = user_dict.get("id")
    email = user_dict.get("email", "")
    org_id = get_or_create_organization_for_user(user_id, email)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organização não encontrada.")
    
    success = save_organization_settings(org_id, payload.model_dump())
    if not success:
        raise HTTPException(status_code=500, detail="Erro ao salvar configurações da organização.")
    return {"status": "ok"}


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
    
    # 1. Carregar roteiro anterior para comparação de diff
    old_steps = {}
    is_first_api_save = not os.path.exists(roteiro_path)
    if not is_first_api_save:
        with open(roteiro_path, "r", encoding="utf-8") as f:
            try:
                old_data = json.load(f)
                for step in old_data.get("roteiro", []):
                    p_num = step.get("passo")
                    if p_num is not None:
                        old_steps[p_num] = step
            except:
                pass
                
    existing_data = {}
    if os.path.exists(roteiro_path):
        with open(roteiro_path, "r", encoding="utf-8") as f:
            try:
                existing_data = json.load(f)
            except:
                pass
                 
    existing_data["session_id"] = session_id
    existing_data["roteiro"] = payload.roteiro
    if payload.titulo:
        existing_data["titulo"] = payload.titulo
        
    # 2. Verificar diffs de seletores e marcar hitl_corrigido
    from api.db_services import get_or_create_organization_for_user
    from sandbox_eng.arbitro_engine import calcular_hash_intencao
    from datetime import datetime, timezone
    
    user_id = user_dict.get("id")
    email = user_dict.get("email", "")
    org_id = get_or_create_organization_for_user(user_id, email)
    
    modulo_id = session_id
    simlink_path = f"data/simlink/{session_id}.json"
    if os.path.exists(simlink_path):
        with open(simlink_path, "r", encoding="utf-8") as f:
            try:
                mod = json.load(f)
                modulo_id = mod.get("modulo_id", session_id)
            except:
                pass
                
    client = get_supabase_client()
    if client and org_id:
        for step in payload.roteiro:
            passo_num = step.get("passo")
            if passo_num is None:
                continue
            simlink = step.get("_simlink", {})
            selector = simlink.get("selector")
            xpath = simlink.get("xpath")
            target_text = simlink.get("target_text")
            
            if not (selector or xpath):
                continue
                
            old_step = old_steps.get(passo_num)
            is_modified = False
            
            if old_step:
                old_simlink = old_step.get("_simlink", {})
                old_selector = old_simlink.get("selector")
                old_xpath = old_simlink.get("xpath")
                old_target_text = old_simlink.get("target_text")
                
                if (selector != old_selector) or (xpath != old_xpath) or (target_text != old_target_text):
                    is_modified = True
            else:
                is_modified = True
                
            if is_modified:
                hash_intencao = calcular_hash_intencao(modulo_id, passo_num, target_text)
                estrategia = "css_selector" if selector else "xpath"
                seletor_vencedor = selector if selector else xpath
                
                try:
                    res_mem = client.table("memoria_semantica").select("id").eq("org_id", org_id).eq("modulo_id", modulo_id).eq("hash_intencao", hash_intencao).execute()
                    if res_mem.data:
                        client.table("memoria_semantica").update({
                            "estrategia_vencedora": estrategia,
                            "seletor": seletor_vencedor,
                            "hitl_corrigido": True,
                            "falhas_consecutivas": 0,
                            "ultimo_uso": datetime.now(timezone.utc).isoformat()
                        }).eq("id", res_mem.data[0]["id"]).execute()
                    else:
                        client.table("memoria_semantica").insert({
                            "org_id": org_id,
                            "modulo_id": modulo_id,
                            "hash_intencao": hash_intencao,
                            "estrategia_vencedora": estrategia,
                            "seletor": seletor_vencedor,
                            "hits": 1,
                            "falhas_consecutivas": 0,
                            "hitl_corrigido": True
                        }).execute()
                    logger.info(f"Registro de memoria semantica {hash_intencao} marcado como hitl_corrigido = TRUE.")
                except Exception as e:
                    logger.error(f"Erro ao salvar correcao hitl na memoria semantica: {e}")
    
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
        if session_id in active_tasks:
            active_tasks[session_id].cancel()
            await asyncio.sleep(0)
        
        update_status(session_id, "rendering_final", "Renderizando vídeo final com roteiro aprovado...")
        task = asyncio.create_task(
            rerenderizar_com_roteiro_aprovado(session_id, payload.roteiro, payload.usar_overlay, payload.voice_id)
        )
        active_tasks[session_id] = task
        task.add_done_callback(_task_exception_handler)
        task.add_done_callback(lambda t: active_tasks.pop(session_id, None))
        
    return {"status": "ok"}

@app.post("/api/v1/session/{session_id}/passo/{passo_num}/regerar")
async def regerar_passo(session_id: str, passo_num: int, user: dict = Depends(require_auth)):
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
    passo_atualizado = await regerar_passo_isolado(passo_alvo, passo_anterior, passo_seguinte, session_id=session_id)

    return {"passo": passo_atualizado}

@app.post("/api/v1/tts/preview", dependencies=_auth_deps)
async def tts_preview(payload: TTSPreviewPayload, request: Request):
    from video_eng.tts_generator import gerar_audio
    import uuid
    os.makedirs("data/artifacts/previews", exist_ok=True)
    filename = f"preview_{uuid.uuid4().hex}.mp3"
    filepath = f"data/artifacts/previews/{filename}"
    sucesso = await gerar_audio(payload.texto, filepath, payload.voice_id)
    if not sucesso:
        raise HTTPException(status_code=500, detail="Falha ao gerar TTS")
    
    base = settings.backend_url
    req_host = request.headers.get("host", "")
    if "api.nomadelabs.com.br" in base and ("localhost" in req_host or "127.0.0.1" in req_host):
        base = f"http://{req_host}"
    url = f"{base}/artifacts/previews/{filename}"
    auth_header = request.headers.get("authorization", "")
    token = auth_header.replace("Bearer ", "").strip() if auth_header.startswith("Bearer ") else request.query_params.get("token")
    if token:
        url += f"?token={token}"
    return {"audio_url": url}

@app.get("/api/v1/session/{session_id}/artifacts", dependencies=_auth_deps)
async def get_artifacts(session_id: str, request: Request):
    """Retorna URLs de todos os artefatos gerados para uma sessão."""
    base = str(request.base_url).rstrip("/")
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
    mod = {}
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

    status_data = get_status(session_id)
    is_completed = (status_data.get("status") == "completed")

    return {
        "session_id": session_id,
        "video_url":       _get_video_url() if (is_completed and (os.path.exists(f"data/videos_gerados/{session_id}_final.mp4") or (settings.supabase_url and settings.supabase_key))) else None,
        "pdf_url":         url_if_exists(f"{art_dir}/apostila.pdf",
                                         f"{base}/artifacts/{session_id}/apostila.pdf") if is_completed else None,
        "transcript_url":  url_if_exists(f"{art_dir}/transcricao.txt",
                                         f"{base}/artifacts/{session_id}/transcricao.txt") if is_completed else None,
        "quiz":            quiz_data if is_completed else [],
        "simlink_url":     simlink_url if is_completed else None,
        "scorm_download_url": url_if_exists(f"data/scorm/{session_id}.zip", f"{base}/scorm/{session_id}.zip") if is_completed else None,
        "scorm_player_url": (f"{base}/scorm-player?modulo={mod.get('modulo_id', '')}" if simlink_url else None) if is_completed else None,
        "status":          status_data.get("status", "unknown")
    }

@app.get("/api/v1/organization/settings", dependencies=_auth_deps)
async def get_org_settings(user_dict: dict = Depends(require_auth)):
    from api.db_services import get_supabase_client, get_or_create_organization_for_user
    client = get_supabase_client()
    if not client:
        raise HTTPException(status_code=500, detail="Supabase client not available")
    
    org_id = get_or_create_organization_for_user(user_dict.get("id"), user_dict.get("email", ""))
    if not org_id:
        raise HTTPException(status_code=404, detail="Organization not found")
        
    res = client.table("organizations").select("disable_whitelist, allowed_domains").eq("id", org_id).execute()
    if not res.data:
        return {"disable_whitelist": True, "allowed_domains": ["localhost", "127.0.0.1", "senior.com.br", "senior.com"]}
        
    org_data = res.data[0]
    return {
        "disable_whitelist": org_data.get("disable_whitelist", True),
        "allowed_domains": org_data.get("allowed_domains") or ["localhost", "127.0.0.1", "senior.com.br", "senior.com"]
    }

from pydantic import BaseModel
from typing import List

class OrgSettingsUpdate(BaseModel):
    disable_whitelist: bool
    allowed_domains: List[str]

@app.put("/api/v1/organization/settings", dependencies=_auth_deps)
async def update_org_settings(settings: OrgSettingsUpdate, user_dict: dict = Depends(require_auth)):
    from api.db_services import get_supabase_client, get_or_create_organization_for_user
    client = get_supabase_client()
    if not client:
        raise HTTPException(status_code=500, detail="Supabase client not available")
        
    org_id = get_or_create_organization_for_user(user_dict.get("id"), user_dict.get("email", ""))
    if not org_id:
        raise HTTPException(status_code=404, detail="Organization not found")
        
    res = client.table("organizations").update({
        "disable_whitelist": settings.disable_whitelist,
        "allowed_domains": settings.allowed_domains
    }).eq("id", org_id).execute()
    
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to update settings")
        
    return {"status": "success", "settings": res.data[0]}

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
async def configurar_simlink(session_id: str, payload: dict, request: Request):
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
        
    base = str(request.base_url).rstrip("/")
    return {"simlink_url": f"{base}/simlink?modulo={mod['modulo_id']}"}

@app.post("/api/v1/ratings")
async def submit_rating(payload: RatingPayload, request: Request, user: dict = Depends(require_auth)):
    """Salva uma avaliação (NPS/CSAT) no Supabase."""
    if not settings.supabase_url or not settings.supabase_key:
        logger.warning("Supabase não configurado. Avaliação ignorada.")
        return {"status": "ignored"}
    
    # Extrair user_id do token JWT decodificado pela dependência require_auth
    user_id = user.get("id") if user else None
    
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

@app.post("/api/v1/sandbox/evaluate")
async def evaluate_sandbox(payload: SandboxActionPayload, user_dict: dict = Depends(require_auth)):
    from sandbox_eng.arbitro_engine import avaliar_acao_sandbox
    from api.db_services import get_or_create_organization_for_user
    
    user_id = user_dict.get("id")
    email = user_dict.get("email", "")
    org_id = get_or_create_organization_for_user(user_id, email)
    
    modulo_id = payload.session_id
    session_id = modulo_id
    
    simlink_path = f"data/simlink/{modulo_id}.json"
    if os.path.exists(simlink_path):
        with open(simlink_path, "r", encoding="utf-8") as f:
            try:
                mod = json.load(f)
                session_id = mod.get("session_id", modulo_id)
                modulo_id = mod.get("modulo_id", modulo_id)
            except:
                pass

    passo_esperado = get_sandbox_state(payload.session_id)
    
    roteiro_path = f"data/roteiros/{session_id}.json"
    if not os.path.exists(roteiro_path):
        return {"is_correct": False, "hint": "Roteiro não encontrado"}
        
    with open(roteiro_path, "r", encoding="utf-8") as f:
        roteiro = json.load(f).get("roteiro", [])
        
    # Filtrar apenas os passos reais (ignorar 0 e 999 se houver)
    roteiro_filtrado = [p for p in roteiro if p.get("passo", 0) not in (0, 999)]
    
    result = await avaliar_acao_sandbox(roteiro_filtrado, passo_esperado, payload.action_data, org_id=org_id, modulo_id=modulo_id)
    
    if result.get("is_correct"):
        set_sandbox_state(payload.session_id, passo_esperado + 1)
        
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


@app.post("/api/v1/admin/memoria-semantica/clean")
async def clean_semantic_memory(user_dict: dict = Depends(require_auth)):
    from api.db_services import get_supabase_client, get_or_create_organization_for_user
    
    user_id = user_dict.get("id")
    email = user_dict.get("email", "")
    org_id = get_or_create_organization_for_user(user_id, email)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organização não encontrada.")
        
    client = get_supabase_client()
    if not client:
        raise HTTPException(status_code=500, detail="Supabase client not available")
        
    try:
        deleted_count = 0

        # 1. Multi-tenant isolation: Remover registros com falhas_consecutivas >= 3 e hitl_corrigido = FALSE para a org_id
        res_fail = client.table("memoria_semantica").delete().eq("org_id", org_id).gte("falhas_consecutivas", 3).eq("hitl_corrigido", False).execute()
        if res_fail and hasattr(res_fail, "data") and res_fail.data:
            deleted_count += len(res_fail.data)
        
        # 2. Multi-tenant isolation: Remover registros de módulos que não existem mais no sistema (modulo pai despublicado/arquivado/deletado)
        res_all = client.table("memoria_semantica").select("*").eq("org_id", org_id).eq("hitl_corrigido", False).execute()
        if res_all.data:
            to_delete = []
            for record in res_all.data:
                mod_id = record.get("modulo_id")
                if mod_id:
                    simlink_file = f"data/simlink/{mod_id}.json"
                    roteiro_file = f"data/roteiros/{mod_id}.json"
                    if not (os.path.exists(simlink_file) or os.path.exists(roteiro_file)):
                        to_delete.append(record["id"])
            if to_delete:
                client.table("memoria_semantica").delete().eq("org_id", org_id).in_("id", to_delete).execute()
                deleted_count += len(to_delete)
                
        return {"status": "ok", "deleted_count": deleted_count}
    except Exception as e:
        logger.error(f"Erro ao limpar memoria semantica: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/api/v1/admin/costs")
def get_admin_costs(user: dict = Depends(require_auth)):
    """Retorna dados agregados de custos de API (FinOps)."""
    from api.db_services import get_or_create_organization_for_user
    user_id = user.get("id")
    email = user.get("email", "")
    auth_org_id = get_or_create_organization_for_user(user_id, email)

    total_cost_usd = 0.0
    total_cost_brl = 0.0
    run_count = 0
    
    instructor_costs = {}
    runs = []
    unverified_cost_warning = False

    metrics_path = "data/finops/metrics.jsonl"
    if os.path.exists(metrics_path):
        try:
            with open(metrics_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        job = json.loads(line)
                    except:
                        continue
                    
                    job_org_id = job.get("org_id")
                    if job_org_id != auth_org_id:
                        continue
                    
                    cost_usd = job.get("estimated_api_cost_usd", 0.0)
                    cost_brl = job.get("estimated_api_cost_brl", 0.0)
                    user_id = job.get("user_id") or "unknown"
                    session_id = job.get("session_id", "sess_unknown")
                    gemini_call_count = job.get("gemini_call_count", 0)
                    
                    if job.get("cost_confidence") == "estimated_unverified":
                        unverified_cost_warning = True
                    
                    total_cost_usd += cost_usd
                    total_cost_brl += cost_brl
                    run_count += 1
                    
                    if user_id not in instructor_costs:
                        instructor_costs[user_id] = {
                            "user_id": user_id,
                            "total_cost_usd": 0.0,
                            "run_count": 0
                        }
                    instructor_costs[user_id]["total_cost_usd"] += cost_usd
                    instructor_costs[user_id]["run_count"] += 1
                    
                    runs.append({
                        "session_id": session_id,
                        "cost_usd": cost_usd,
                        "gemini_call_count": gemini_call_count
                    })
        except Exception as e:
            logger.error(f"Erro ao ler arquivo de métricas finops: {e}")

    avg_cost_per_run_usd = round(total_cost_usd / run_count, 4) if run_count > 0 else 0.0
    
    cost_by_instructor = []
    for inst_id, stats in instructor_costs.items():
        stats["total_cost_usd"] = round(stats["total_cost_usd"], 4)
        cost_by_instructor.append(stats)
        
    runs.sort(key=lambda r: r["cost_usd"], reverse=True)
    most_expensive_runs = runs[:5]
    for r in most_expensive_runs:
        r["cost_usd"] = round(r["cost_usd"], 4)
        session_id = r.get("session_id")
        titulo = None
        if session_id:
            roteiro_path = f"data/roteiros/{session_id}.json"
            if os.path.exists(roteiro_path):
                try:
                    with open(roteiro_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        titulo = data.get("titulo")
                except Exception:
                    pass
            if not titulo:
                simlink_path = f"data/simlink/{session_id}.json"
                if os.path.exists(simlink_path):
                    try:
                        with open(simlink_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            titulo = data.get("titulo")
                    except Exception:
                        pass
        r["titulo"] = titulo or (f"Sessão {session_id[-8:]}" if session_id else "Sem título")

    from api.finops_telemetry import get_usd_to_brl_rate
    current_rate = get_usd_to_brl_rate()

    return {
        "total_cost_usd": round(total_cost_usd, 4),
        "total_cost_brl": round(total_cost_usd * current_rate if total_cost_brl == 0 else total_cost_brl, 4),
        "usd_to_brl_rate": round(current_rate, 4),
        "avg_cost_per_run_usd": avg_cost_per_run_usd,
        "cost_by_instructor": cost_by_instructor,
        "most_expensive_runs": most_expensive_runs,
        "unverified_cost_warning": unverified_cost_warning
    }


@app.get("/api/v1/auth/dev-token")
def get_dev_token(request: Request):
    """Retorna um token JWT assinado válido para desenvolvimento local (boris.renan@gmail.com).

    Limitado por segurança apenas a conexões vindas do próprio localhost.
    """
    from config.settings import get_settings
    settings = get_settings()
    if not settings.allow_dev_token:
        raise HTTPException(status_code=403, detail="Endpoint de dev-token desabilitado neste ambiente.")

    client_host = request.client.host if request.client else "unknown"
    if client_host not in ("127.0.0.1", "localhost", "::1"):
        raise HTTPException(status_code=403, detail="Apenas conexões locais são permitidas.")

    import time
    import hmac
    import hashlib
    import base64
    from config.settings import get_settings
    
    settings = get_settings()
    secret = settings.jwt_secret
    
    now = int(time.time())
    payload = {
        "iss": f"{settings.supabase_url}/auth/v1",
        "sub": "3a50c712-73b5-440a-b35f-6dd87339e582",
        "aud": "authenticated",
        "exp": now + 86400,  # 24 horas de validade
        "iat": now,
        "email": "boris.renan@gmail.com",
        "app_metadata": {"provider": "email", "providers": ["email"]},
        "user_metadata": {
            "email": "boris.renan@gmail.com",
            "email_verified": True,
            "sub": "3a50c712-73b5-440a-b35f-6dd87339e582"
        },
        "role": "authenticated",
        "aal": "aal1",
        "amr": [{"method": "otp", "timestamp": now}],
        "session_id": "dev_session_active",
        "is_anonymous": False
    }
    
    def _b64url(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")
        
    header = {"alg": "HS256", "typ": "JWT"}
    segments = [
        _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
    ]
    signing_input = ".".join(segments).encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    segments.append(_b64url(signature))
    token = ".".join(segments)
    
    return {"token": token}


@app.get("/api/v1/auth/me")
def get_current_user_profile(user: dict = Depends(require_auth)):
    """Retorna informações do usuário autenticado no sistema."""
    return {
        "id": user.get("id"),
        "email": user.get("email", "boris.renan@gmail.com"),
        "role": "gestor"
    }
