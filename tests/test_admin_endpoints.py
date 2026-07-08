import pytest
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)

def test_admin_metrics_without_token():
    # Deve retornar 401 Unauthorized
    response = client.get("/api/v1/admin/metrics")
    assert response.status_code == 401

def test_admin_pipeline_runs_without_token():
    # Deve retornar 401 Unauthorized
    response = client.get("/api/v1/admin/pipeline-runs")
    assert response.status_code == 401

# Com token válido, exigiria mockar dependências do Supabase, 
# mas já testamos o bloqueio de segurança na borda (Camada de Auth).
