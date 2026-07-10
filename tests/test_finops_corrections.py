import os
import json
import pytest
from api.finops_telemetry import FinOpsTracker
from fastapi.testclient import TestClient
from api.main import app
from api.auth import require_auth

def test_finops_pricing_and_confidence():
    """Valida as constantes de preço e o flag de confiabilidade (MiniMax)."""
    # 1. Caso 1: Apenas Gemini e OpenAI -> Confirmed
    session_id = "test_sess_conf"
    FinOpsTracker.start_job(session_id, user_id="user_1", org_id="org_A")
    
    # 10k input, 5k output Gemini
    FinOpsTracker.add_tokens(session_id, "gemini", 10000, 5000)
    # 2k input, 1k output OpenAI
    FinOpsTracker.add_tokens(session_id, "openai", 2000, 1000)
    
    job = FinOpsTracker.finish_job(session_id)
    assert job is not None
    assert job["cost_confidence"] == "confirmed"
    
    # Custo Gemini: 10000 * 0.30/1M ($0.003) + 5000 * 2.50/1M ($0.0125) = $0.0155
    # Custo OpenAI: 2000 * 0.15/1M ($0.0003) + 1000 * 0.60/1M ($0.0006) = $0.0009
    # Total: $0.0164
    assert abs(job["estimated_api_cost_usd"] - 0.0164) < 1e-6
    assert job["gemini_call_count"] == 1
    
    # 2. Caso 2: Contém MiniMax -> Estimated Unverified
    session_id_mini = "test_sess_mini"
    FinOpsTracker.start_job(session_id_mini, user_id="user_1", org_id="org_A")
    FinOpsTracker.add_tokens(session_id_mini, "minimax", 50000, 50000)
    
    job_mini = FinOpsTracker.finish_job(session_id_mini)
    assert job_mini["cost_confidence"] == "estimated_unverified"
    # Custo MiniMax: 50000 * 0.10/1M ($0.005) + 50000 * 0.10/1M ($0.005) = $0.010
    assert abs(job_mini["estimated_api_cost_usd"] - 0.01) < 1e-6


def test_finops_stale_job_sweep():
    """Valida que a limpeza periódica fecha jobs inativos e os grava."""
    session_id = "test_sess_stale"
    FinOpsTracker.start_job(session_id, user_id="user_1", org_id="org_A")
    
    # Simula passagem de tempo alterando start_time do job em memória
    if session_id in FinOpsTracker._jobs:
        FinOpsTracker._jobs[session_id]["start_time"] = 0.0  # Muito antigo
        
    # Iniciar um novo job ativa a limpeza automática
    FinOpsTracker.start_job("new_sess_trigger")
    
    # O job inativo deve ter sido removido e persistido como abandoned_or_error
    assert session_id not in FinOpsTracker._jobs
    
    # Limpa trigger
    FinOpsTracker.finish_job("new_sess_trigger")


def test_admin_costs_endpoint(monkeypatch):
    """Valida o endpoint GET /api/v1/admin/costs com isolamento de org_id."""
    import api.db_services
    monkeypatch.setattr(api.db_services, "get_or_create_organization_for_user", lambda *args, **kwargs: "org_A")

    # Mock do usuário autenticado (pertence a org_A) via dependency overrides do FastAPI
    app.dependency_overrides[require_auth] = lambda: {
        "id": "user_admin",
        "org_id": "org_A",
        "user_metadata": {"org_id": "org_A"}
    }
    
    # Cria registros falsos no arquivo data/finops/metrics.jsonl
    import shutil
    metrics_path = "data/finops/metrics.jsonl"
    backup_path = "data/finops/metrics.jsonl.bak"
    os.makedirs("data/finops", exist_ok=True)
    
    backup_exists = os.path.exists(metrics_path)
    if backup_exists:
        shutil.move(metrics_path, backup_path)
    
    test_metrics = [
        # org_A - confirmado
        {
            "session_id": "sess_a1", "user_id": "instructor_1", "org_id": "org_A",
            "estimated_api_cost_usd": 0.005, "estimated_api_cost_brl": 0.028,
            "cost_confidence": "confirmed", "gemini_call_count": 2
        },
        # org_A - estimated_unverified (MiniMax)
        {
            "session_id": "sess_a2", "user_id": "instructor_1", "org_id": "org_A",
            "estimated_api_cost_usd": 0.015, "estimated_api_cost_brl": 0.084,
            "cost_confidence": "estimated_unverified", "gemini_call_count": 6
        },
        # org_B (deve ser filtrado e não exibido)
        {
            "session_id": "sess_b1", "user_id": "instructor_2", "org_id": "org_B",
            "estimated_api_cost_usd": 0.50, "estimated_api_cost_brl": 2.80,
            "cost_confidence": "confirmed", "gemini_call_count": 1
        }
    ]
    
    # Sobrescreve/Cria o arquivo temporariamente para o teste
    with open(metrics_path, "w", encoding="utf-8") as f:
        for m in test_metrics:
            f.write(json.dumps(m) + "\n")
            
    try:
        client = TestClient(app)
        response = client.get("/api/v1/admin/costs")
        assert response.status_code == 200
        
        data = response.json()
        # total_cost_usd de org_A = 0.005 + 0.015 = 0.02
        assert abs(data["total_cost_usd"] - 0.02) < 1e-6
        # avg_cost_per_run_usd = 0.02 / 2 = 0.01
        assert abs(data["avg_cost_per_run_usd"] - 0.01) < 1e-6
        
        # unverified_cost_warning = True (porque a2 utilizou MiniMax)
        assert data["unverified_cost_warning"] is True
        
        # most_expensive_runs deve conter a2 (mais caro) e a1, mas NÃO b1
        assert len(data["most_expensive_runs"]) == 2
        assert data["most_expensive_runs"][0]["session_id"] == "sess_a2"
        assert data["most_expensive_runs"][0]["gemini_call_count"] == 6
        
    finally:
        # Limpa dependency override
        app.dependency_overrides.pop(require_auth, None)
        # Remove arquivo de teste
        if os.path.exists(metrics_path):
            os.remove(metrics_path)
        # Restaura backup
        if backup_exists and os.path.exists(backup_path):
            shutil.move(backup_path, metrics_path)
