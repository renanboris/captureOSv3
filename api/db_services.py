import os
import json
import logging
from typing import Optional
from supabase import create_client, Client
from config.settings import get_settings

logger = logging.getLogger(__name__)

def get_supabase_client() -> Optional[Client]:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_key:
        return None
    try:
        return create_client(settings.supabase_url, settings.supabase_key)
    except Exception as e:
        logger.error(f"Failed to create Supabase client: {e}")
        return None

# Cache em memória de mapeamento user_id -> organization_id
_USER_ORG_CACHE: dict[str, str] = {}


def get_or_create_organization_for_user(user_id: str, user_email: str) -> str:
    default_org_id = "00000000-0000-0000-0000-000000000001"
    if not user_id:
        user_id = "3a50c712-73b5-440a-b35f-6dd87339e582"

    if user_id in _USER_ORG_CACHE:
        return _USER_ORG_CACHE[user_id]

    client = get_supabase_client()
    if not client:
        return default_org_id
        
    try:
        # First, check if the user is already in an organization
        res = client.table("organization_members").select("organization_id").eq("user_id", user_id).execute()
        if res.data and len(res.data) > 0:
            org_id = res.data[0]["organization_id"]
            _USER_ORG_CACHE[user_id] = org_id
            return org_id
            
        # If not, create a personal workspace (B2C behavior)
        org_name = f"Workspace de {user_email.split('@')[0]}" if user_email else "Personal Workspace"
        org_res = client.table("organizations").insert({
            "name": org_name,
            "disable_whitelist": True
        }).execute()
        
        if not org_res.data:
            return default_org_id
            
        org_id = org_res.data[0]["id"]
        
        # Link the user as owner
        client.table("organization_members").insert({
            "organization_id": org_id,
            "user_id": user_id,
            "role": "owner"
        }).execute()
        
        logger.info(f"Created new personal workspace {org_id} for user {user_id}")
        _USER_ORG_CACHE[user_id] = org_id
        return org_id
    except Exception as e:
        logger.error(f"Error in get_or_create_organization_for_user: {e}")
        return default_org_id

def create_pipeline_run(
    session_id: str, 
    instructor_id: str, 
    organization_id: str, 
    detected_interface_type: str = "unknown"
) -> None:
    client = get_supabase_client()
    if not client:
        return
    
    try:
        client.table("pipeline_runs").insert({
            "session_id": session_id,
            "instructor_id": instructor_id,
            "organization_id": organization_id,
            "status": "processing",
            "detected_interface_type": detected_interface_type
        }).execute()
        logger.info(f"PipelineRun created for session {session_id}")
    except Exception as e:
        logger.error(f"Error creating PipelineRun for session {session_id}: {e}")

def update_pipeline_run_status(
    session_id: str, 
    status: str, 
    failure_stage: Optional[str] = None
) -> None:
    client = get_supabase_client()
    if not client:
        return
        
    try:
        update_data = {"status": status}
        if failure_stage:
            update_data["failure_stage"] = failure_stage
            
        client.table("pipeline_runs").update(update_data).eq("session_id", session_id).execute()
        logger.info(f"PipelineRun status updated for session {session_id} to {status}")
    except Exception as e:
        logger.error(f"Error updating PipelineRun status for session {session_id}: {e}")

def save_roteiro_version(
    session_id: str,
    version: int,
    text_content: str,
    created_by: str
) -> None:
    client = get_supabase_client()
    if not client:
        return
        
    try:
        # First get the pipeline_run_id for this session
        run_res = client.table("pipeline_runs").select("id").eq("session_id", session_id).execute()
        if not run_res.data:
            logger.warning(f"No PipelineRun found for session {session_id} when saving Roteiro")
            return
            
        pipeline_run_id = run_res.data[0]["id"]
        
        client.table("roteiro_versoes").upsert({
            "pipeline_run_id": pipeline_run_id,
            "version": version,
            "text_content": text_content,
            "created_by": created_by
        }).execute()
        logger.info(f"Roteiro version {version} saved for session {session_id}")
    except Exception as e:
        logger.error(f"Error saving Roteiro version for session {session_id}: {e}")

def get_pipeline_runs_for_organization(
    organization_id: str, 
    limit: int = 50, 
    offset: int = 0,
    status_filter: Optional[str] = None
) -> dict:
    client = get_supabase_client()
    runs = []
    total_count = 0
    
    if client:
        try:
            query = client.table("pipeline_runs").select("*", count="exact").eq("organization_id", organization_id)
            if status_filter:
                query = query.eq("status", status_filter)
                
            res = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
            if res.data:
                runs = res.data
                total_count = res.count or len(runs)
        except Exception as e:
            logger.error(f"Error fetching pipeline_runs from Supabase: {e}")

    # Fallback local disk scan if no runs in Supabase
    if not runs:
        import glob
        from datetime import datetime, timezone
        local_runs = []
        for filepath in glob.glob("data/simlink/*.json"):
            if filepath.endswith("_resultado.json"):
                continue
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    mod = json.load(f)
                sid = mod.get("session_id") or os.path.basename(filepath).replace(".json", "")
                local_runs.append({
                    "id": sid,
                    "session_id": sid,
                    "organization_id": organization_id,
                    "instructor_id": "boris.renan@gmail.com",
                    "status": "completed",
                    "failure_stage": None,
                    "detected_interface_type": mod.get("dominio", "web"),
                    "recording_duration_seconds": 300,
                    "created_at": mod.get("criado_em", datetime.now(timezone.utc).isoformat()),
                    "titulo": mod.get("titulo") or f"Módulo {sid[:8]}"
                })
            except Exception:
                pass
        total_count = len(local_runs)
        if limit > 0:
            runs = local_runs[offset: offset + limit]
        else:
            runs = local_runs

    # Enriquecer os runs com os títulos dos arquivos json se disponíveis
    import os
    import json
    for run in runs:
        if not run.get("titulo"):
            session_id = run.get("session_id")
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
            run["titulo"] = titulo or (f"Sessão {session_id[-8:]}" if session_id else "Sem título")
            
    return {"runs": runs, "total": total_count}


def get_organization_settings(organization_id: str) -> dict:
    default_settings = {
        "disable_whitelist": True,
        "allowed_domains": ["localhost", "127.0.0.1", "senior.com.br", "senior.com"]
    }

    def _read_local():
        settings_file = "data/organization_settings.json"
        if os.path.exists(settings_file):
            try:
                with open(settings_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if organization_id in data:
                        return data[organization_id]
            except Exception as e:
                logger.error(f"Error reading local organization settings: {e}")
        return None

    client = get_supabase_client()
    if client:
        try:
            res = client.table("organizations").select("disable_whitelist", "allowed_domains").eq("id", organization_id).execute()
            if res.data and len(res.data) > 0:
                org_data = res.data[0]
                disable_whitelist = org_data.get("disable_whitelist")
                allowed_domains = org_data.get("allowed_domains")
                return {
                    "disable_whitelist": disable_whitelist if disable_whitelist is not None else True,
                    "allowed_domains": allowed_domains if allowed_domains is not None else default_settings["allowed_domains"]
                }
        except Exception as e:
            logger.error(f"Error fetching organization settings for org {organization_id}: {e}")

    local_data = _read_local()
    if local_data is not None:
        return local_data

    return default_settings


def save_organization_settings(organization_id: str, settings_data: dict) -> bool:
    disable_whitelist = settings_data.get("disable_whitelist", True)
    allowed_domains = settings_data.get("allowed_domains", ["localhost", "127.0.0.1", "senior.com.br", "senior.com"])

    # Always persist locally for resilience
    settings_file = "data/organization_settings.json"
    data = {}
    if os.path.exists(settings_file):
        try:
            with open(settings_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            logger.error(f"Error reading local organization settings for write: {e}")

    data[organization_id] = {
        "disable_whitelist": disable_whitelist,
        "allowed_domains": allowed_domains
    }

    try:
        os.makedirs(os.path.dirname(settings_file), exist_ok=True)
        with open(settings_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error writing local organization settings: {e}")

    client = get_supabase_client()
    if client:
        try:
            client.table("organizations").update({
                "disable_whitelist": disable_whitelist,
                "allowed_domains": allowed_domains
            }).eq("id", organization_id).execute()
            logger.info(f"Organization settings saved in Supabase for org {organization_id}")
        except Exception as e:
            logger.error(f"Error saving organization settings in Supabase for org {organization_id}: {e}")

    return True

