import json
import os

os.makedirs("data/status", exist_ok=True)

def update_status(session_id: str, status: str, message: str = ""):
    filepath = f"data/status/{session_id}.json"
    data = {"status": status, "message": message}
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

def get_status(session_id: str):
    filepath = f"data/status/{session_id}.json"
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {"status": "unknown", "message": "Sessão não encontrada."}
