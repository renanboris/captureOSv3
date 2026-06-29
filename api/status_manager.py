import json
import os
import threading

os.makedirs("data/status", exist_ok=True)

def update_status(session_id: str, status: str, message: str = ""):
    filepath = f"data/status/{session_id}.json"
    data = {"status": status, "message": message}
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    
    # Update Supabase asynchronously to avoid blocking
    from api.db_services import update_pipeline_run_status
    failure_stage = None
    if status == "failed":
        if "gerar o roteiro" in message.lower() or "gemini" in message.lower():
            failure_stage = "ai_generation"
        elif "vídeo" in message.lower() or "áudio" in message.lower() or "render" in message.lower():
            failure_stage = "video_render"
        elif "scorm" in message.lower():
            failure_stage = "scorm_export"
        else:
            failure_stage = "capture"
            
    # Fire and forget in a background thread so we don't slow down the engines
    threading.Thread(
        target=update_pipeline_run_status, 
        args=(session_id, "tech_error" if status == "failed" else status, failure_stage),
        daemon=True
    ).start()

def get_status(session_id: str):
    filepath = f"data/status/{session_id}.json"
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {"status": "unknown", "message": "Sessão não encontrada."}
