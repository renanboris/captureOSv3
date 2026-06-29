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

def get_or_create_organization_for_user(user_id: str, user_email: str) -> Optional[str]:
    client = get_supabase_client()
    if not client:
        return None
        
    try:
        # First, check if the user is already in an organization
        res = client.table("organization_members").select("organization_id").eq("user_id", user_id).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]["organization_id"]
            
        # If not, create a personal workspace (B2C behavior)
        org_name = f"Workspace de {user_email.split('@')[0]}" if user_email else "Personal Workspace"
        org_res = client.table("organizations").insert({"name": org_name}).execute()
        
        if not org_res.data:
            return None
            
        org_id = org_res.data[0]["id"]
        
        # Link the user as owner
        client.table("organization_members").insert({
            "organization_id": org_id,
            "user_id": user_id,
            "role": "owner"
        }).execute()
        
        logger.info(f"Created new personal workspace {org_id} for user {user_id}")
        return org_id
    except Exception as e:
        logger.error(f"Error in get_or_create_organization_for_user: {e}")
        return None

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
    if not client:
        return {"runs": [], "total": 0}
        
    try:
        query = client.table("pipeline_runs").select("*", count="exact").eq("organization_id", organization_id)
        if status_filter:
            query = query.eq("status", status_filter)
            
        res = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        return {
            "runs": res.data if res.data else [],
            "total": res.count if res.count is not None else 0
        }
    except Exception as e:
        logger.error(f"Error fetching pipeline runs for org {organization_id}: {e}")
        return {"runs": [], "total": 0}
