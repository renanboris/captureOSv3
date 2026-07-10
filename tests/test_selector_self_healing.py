import pytest
import os
import json
import hashlib
import asyncio
from datetime import datetime, timezone, timedelta
from fastapi import Depends
from api.main import app
from api.auth import require_auth
import api.db_services as db_services
import sandbox_eng.arbitro_engine as arbitro_engine
from sandbox_eng.arbitro_engine import (
    eh_seletor_fragil,
    verificar_identidade,
    calcular_hash_intencao,
    avaliar_acao_sandbox
)


class MockTableQuery:
    def __init__(self, table_name, data_store):
        self.table_name = table_name
        self.data_store = data_store
        self.filters = {}
        self.is_delete = False
        self.update_data = None

    def select(self, *args, **kwargs):
        return self

    def eq(self, field, value):
        self.filters[field] = value
        return self

    def lt(self, field, value):
        self.filters[f"{field}__lt"] = value
        return self

    def gte(self, field, value):
        self.filters[f"{field}__gte"] = value
        return self

    def in_(self, field, values):
        self.filters[f"{field}__in"] = values
        return self

    def delete(self):
        self.is_delete = True
        return self

    def update(self, data):
        self.update_data = data
        return self

    def insert(self, data):
        if self.table_name not in self.data_store:
            self.data_store[self.table_name] = []
        
        if isinstance(data, list):
            inserted = []
            for item in data:
                if "id" not in item:
                    item["id"] = f"mock-uuid-{len(self.data_store[self.table_name])}"
                self.data_store[self.table_name].append(item)
                inserted.append(item)
            class Response:
                def __init__(self, data):
                    self.data = data
            return Response(inserted)
        else:
            if "id" not in data:
                data["id"] = f"mock-uuid-{len(self.data_store[self.table_name])}"
            self.data_store[self.table_name].append(data)
            class Response:
                def __init__(self, data):
                    self.data = [data]
            return Response(data)

    def execute(self):
        results = []
        remaining = []
        for item in self.data_store.get(self.table_name, []):
            match = True
            for f_key, f_val in self.filters.items():
                if "__lt" in f_key:
                    real_key = f_key.replace("__lt", "")
                    if not (item.get(real_key) < f_val):
                        match = False
                elif "__gte" in f_key:
                    real_key = f_key.replace("__gte", "")
                    if not (item.get(real_key) >= f_val):
                        match = False
                elif "__in" in f_key:
                    real_key = f_key.replace("__in", "")
                    if item.get(real_key) not in f_val:
                        match = False
                else:
                    if item.get(f_key) != f_val:
                        match = False
            if match:
                results.append(item)
            else:
                remaining.append(item)
        
        if self.is_delete:
            self.data_store[self.table_name] = remaining
            class Response:
                def __init__(self, data):
                    self.data = data
            return Response([])
            
        if self.update_data is not None:
            for item in results:
                item.update(self.update_data)
            class Response:
                def __init__(self, data):
                    self.data = data
            return Response(results)
            
        class Response:
            def __init__(self, data):
                self.data = data
        return Response(results)


class MockSupabaseClient:
    def __init__(self):
        self.data_store = {
            "memoria_semantica": [],
            "pipeline_runs": [{"id": "run-id-1", "session_id": "sess_test"}],
            "roteiro_versoes": []
        }

    def table(self, table_name):
        return MockTableQuery(table_name, self.data_store)


@pytest.fixture
def mock_supabase(monkeypatch):
    client = MockSupabaseClient()
    monkeypatch.setattr(db_services, "get_supabase_client", lambda: client)
    monkeypatch.setattr(arbitro_engine, "get_supabase_client", lambda: client)
    return client


def test_eh_seletor_fragil():
    assert eh_seletor_fragil("button:nth-child(3)") is True
    assert eh_seletor_fragil("div.main-container > p:nth-of-type(1)") is True
    assert eh_seletor_fragil("//div/li[2]/span") is True
    assert eh_seletor_fragil("button#btn-save") is False
    assert eh_seletor_fragil("[data-testid='btn-action']") is False
    assert eh_seletor_fragil(None) is False


def test_verificar_identidade():
    assert verificar_identidade("Salvar", "salvar") is True
    assert verificar_identidade("  Salvar  ", "salvar") is True
    assert verificar_identidade("", "qualquer_coisa") is True  # fail-open
    assert verificar_identidade("Confirmar", "Cancelar") is False
    assert verificar_identidade("Empresa 1", "Empresa 10") is False


def test_calcular_hash_intencao():
    hash1 = calcular_hash_intencao("mod1", 2, "Salvar")
    hash2 = calcular_hash_intencao("mod1", 2, "salvar ")
    assert hash1 == hash2
    assert len(hash1) == 32


def test_avaliar_acao_sandbox_degrades_gracefully():
    roteiro = [
        {"passo": 1, "intencao_original": "clique", "_simlink": {"target_text": "Salvar", "selector": "#btn-save", "xpath": "/html/body/button"}}
    ]
    action_data = {"target_text": "Salvar", "css_selector": "#btn-save", "xpath": "/html/body/button", "url": "http://test.url"}
    
    loop = asyncio.get_event_loop()
    res = loop.run_until_complete(avaliar_acao_sandbox(roteiro, 1, action_data))
    assert res == {"is_correct": True, "hint": ""}


def test_avaliar_acao_sandbox_layer_0_brain_hit(mock_supabase):
    org_id = "00000000-0000-0000-0000-000000000001"
    modulo_id = "00000000-0000-0000-0000-000000000002"
    hash_int = calcular_hash_intencao(modulo_id, 1, "Salvar")
    
    mock_supabase.table("memoria_semantica").insert({
        "org_id": org_id,
        "modulo_id": modulo_id,
        "hash_intencao": hash_int,
        "estrategia_vencedora": "css_selector",
        "seletor": "#btn-save",
        "hits": 5,
        "falhas_consecutivas": 0,
        "hitl_corrigido": False
    })
    
    roteiro = [
        {"passo": 1, "intencao_original": "clique", "_simlink": {"target_text": "Salvar", "selector": "#btn-save", "xpath": "/html/body/button"}}
    ]
    action_data = {"target_text": "Salvar", "css_selector": "#btn-save", "xpath": "/html/body/button", "url": "http://test.url"}
    
    loop = asyncio.get_event_loop()
    res = loop.run_until_complete(avaliar_acao_sandbox(roteiro, 1, action_data, org_id=org_id, modulo_id=modulo_id))
    assert res == {"is_correct": True, "hint": ""}
    
    record = mock_supabase.data_store["memoria_semantica"][0]
    assert record["hits"] == 6
    assert record["falhas_consecutivas"] == 0


def test_avaliar_acao_sandbox_layer_0_brain_identity_failure(mock_supabase):
    org_id = "00000000-0000-0000-0000-000000000001"
    modulo_id = "00000000-0000-0000-0000-000000000002"
    hash_int = calcular_hash_intencao(modulo_id, 1, "Salvar")
    
    mock_supabase.table("memoria_semantica").insert({
        "org_id": org_id,
        "modulo_id": modulo_id,
        "hash_intencao": hash_int,
        "estrategia_vencedora": "css_selector",
        "seletor": "#btn-save",
        "hits": 2,
        "falhas_consecutivas": 0,
        "hitl_corrigido": False
    })
    
    roteiro = [
        {"passo": 1, "intencao_original": "clique", "_simlink": {"target_text": "Salvar", "selector": "#btn-different", "xpath": "/html/body/different"}}
    ]
    action_data = {"target_text": "Sair", "css_selector": "#btn-save", "xpath": "/html/body/button", "url": "http://test.url"}
    
    loop = asyncio.get_event_loop()
    loop.run_until_complete(avaliar_acao_sandbox(roteiro, 1, action_data, org_id=org_id, modulo_id=modulo_id))
    
    record = mock_supabase.data_store["memoria_semantica"][0]
    assert record["falhas_consecutivas"] == 1


def test_avaliar_acao_sandbox_layer_0_brain_fragile_selector_re_evaluation(mock_supabase):
    org_id = "00000000-0000-0000-0000-000000000001"
    modulo_id = "00000000-0000-0000-0000-000000000002"
    
    hash_int = calcular_hash_intencao(modulo_id, 1, "")
    mock_supabase.table("memoria_semantica").insert({
        "org_id": org_id,
        "modulo_id": modulo_id,
        "hash_intencao": hash_int,
        "estrategia_vencedora": "css_selector",
        "seletor": "button:nth-child(3)",
        "hits": 2,
        "falhas_consecutivas": 0,
        "hitl_corrigido": False
    })
    
    roteiro = [
        {"passo": 1, "intencao_original": "clique", "_simlink": {"target_text": "", "selector": "button:nth-child(3)"}}
    ]
    action_data = {"target_text": "", "css_selector": "button:nth-child(3)", "url": "http://test.url"}
    
    loop = asyncio.get_event_loop()
    res = loop.run_until_complete(avaliar_acao_sandbox(roteiro, 1, action_data, org_id=org_id, modulo_id=modulo_id))
    assert res == {"is_correct": True, "hint": ""}
    
    record = mock_supabase.data_store["memoria_semantica"][0]
    assert record["hits"] == 3  # Incrementado pela Camada 1 (CSS selector structural match)
    
    # Verificar telemetria
    telemetry_file = "data/arbitro_telemetria.jsonl"
    assert os.path.exists(telemetry_file)
    with open(telemetry_file, "r", encoding="utf-8") as f:
        lines = f.readlines()
        last_event = json.loads(lines[-1].strip())
        assert last_event["camada"] == "1_selector"
        assert last_event["sucesso"] is True


def test_clean_semantic_memory_endpoint(mock_supabase, monkeypatch):
    from fastapi.testclient import TestClient
    
    app.dependency_overrides[require_auth] = lambda: {"id": "user-1", "email": "test@example.com"}
    monkeypatch.setattr(db_services, "get_or_create_organization_for_user", lambda *args: "00000000-0000-0000-0000-000000000001")
    
    client = TestClient(app)
    
    now_utc = datetime.now(timezone.utc)
    old_date = now_utc - timedelta(days=95)
    
    mock_supabase.table("memoria_semantica").insert({
        "id": "del-failures",
        "org_id": "00000000-0000-0000-0000-000000000001",
        "modulo_id": "mod-1",
        "hash_intencao": "hash1",
        "estrategia_vencedora": "css_selector",
        "seletor": "#btn-test",
        "falhas_consecutivas": 3,
        "hitl_corrigido": False,
        "ultimo_uso": now_utc.isoformat()
    })
    
    mock_supabase.table("memoria_semantica").insert({
        "id": "del-old",
        "org_id": "00000000-0000-0000-0000-000000000001",
        "modulo_id": "mod-1",
        "hash_intencao": "hash2",
        "estrategia_vencedora": "css_selector",
        "seletor": "#btn-test2",
        "falhas_consecutivas": 0,
        "hitl_corrigido": False,
        "ultimo_uso": old_date.isoformat()
    })
    
    mock_supabase.table("memoria_semantica").insert({
        "id": "keep-hitl",
        "org_id": "00000000-0000-0000-0000-000000000001",
        "modulo_id": "mod-1",
        "hash_intencao": "hash3",
        "estrategia_vencedora": "css_selector",
        "seletor": "#btn-test3",
        "falhas_consecutivas": 0,
        "hitl_corrigido": True,
        "ultimo_uso": old_date.isoformat()
    })
    
    mock_supabase.table("memoria_semantica").insert({
        "id": "keep-fragile",
        "org_id": "00000000-0000-0000-0000-000000000001",
        "modulo_id": "mod-1",
        "hash_intencao": "hash4",
        "estrategia_vencedora": "css_selector",
        "seletor": "button:nth-child(2)",
        "falhas_consecutivas": 0,
        "hitl_corrigido": False,
        "ultimo_uso": old_date.isoformat()
    })
    
    resp = client.post("/api/v1/admin/memoria-semantica/clean")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    
    remaining_ids = [item["id"] for item in mock_supabase.data_store["memoria_semantica"]]
    
    assert "del-failures" not in remaining_ids
    assert "del-old" not in remaining_ids
    assert "keep-hitl" in remaining_ids
    assert "keep-fragile" in remaining_ids
    
    app.dependency_overrides.pop(require_auth, None)


def test_save_roteiro_flags_hitl_corrigido(mock_supabase, monkeypatch):
    from fastapi.testclient import TestClient
    
    app.dependency_overrides[require_auth] = lambda: {"id": "user-1", "email": "test@example.com"}
    monkeypatch.setattr(db_services, "get_or_create_organization_for_user", lambda *args: "00000000-0000-0000-0000-000000000001")
    
    roteiros_dir = "data/roteiros"
    os.makedirs(roteiros_dir, exist_ok=True)
    roteiro_file = os.path.join(roteiros_dir, "sess_test.json")
    
    with open(roteiro_file, "w", encoding="utf-8") as f:
        json.dump({
            "session_id": "sess_test",
            "roteiro": [
                {"passo": 1, "intencao_original": "clique", "_simlink": {"target_text": "Salvar", "selector": "#btn-old", "xpath": "/html/body/button"}}
            ]
        }, f)
        
    client = TestClient(app)
    
    payload = {
        "roteiro": [
            {"passo": 1, "intencao_original": "clique", "_simlink": {"target_text": "Salvar", "selector": "#btn-new-selector-edited", "xpath": "/html/body/button"}}
        ],
        "titulo": "Roteiro Novo",
        "aprovado": False
    }
    
    resp = client.post("/api/v1/session/sess_test/roteiro", json=payload)
    assert resp.status_code == 200
    
    memories = mock_supabase.data_store["memoria_semantica"]
    assert len(memories) == 1
    assert memories[0]["hitl_corrigido"] is True
    assert memories[0]["seletor"] == "#btn-new-selector-edited"
    
    if os.path.exists(roteiro_file):
        os.remove(roteiro_file)
    app.dependency_overrides.pop(require_auth, None)
