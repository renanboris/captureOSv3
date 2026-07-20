from fastapi.testclient import TestClient
from api.main import app
from contracts.handoff_schema import RoteiroHandoff, MetadataRoteiro, PassoRoteiro


def test_ingest_endpoint_mock(client):
    import json
    data = {
        "session_id": "sess_123",
        "events": json.dumps([
            {
                "timestamp": 123456789,
                "type": "click",
                "eventData": {
                    "action": "click",
                    "target_tag": "BUTTON",
                    "target_text": "Salvar",
                    "a11y_tree": [
                        {
                            "som_id": 1,
                            "tag": "button",
                            "geometry": {"x": 10, "y": 10, "w": 100, "h": 30}
                        }
                    ]
                },
                "screenshotData": "" # Vazio pra nao quebrar no base64
            }
        ]),
        "modo_input": "A"
    }
    files = [("video", ("capture.webm", b"dummy-video-bytes", "video/webm"))]
    
    response = client.post("/api/v1/capture/ingest", data=data, files=files)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["status"] == "ok"
    assert res_data["session_id"] == "sess_123"
    
def test_handoff_schema_validation():
    passo = PassoRoteiro(
        passo=1,
        timestamp=1000,
        intencao_corporativa="Clicar no botão",
        geometria_clique={"x": 10, "y": 20},
        tag_alvo="button",
        texto_alvo="Salvar"
    )
    
    meta = MetadataRoteiro(
        session_id="123",
        resolucao={"w": 1920, "h": 1080}
    )
    
    roteiro = RoteiroHandoff(
        metadata=meta,
        configuracao_gravacao={"fps": 30},
        passos=[passo]
    )
    
    assert roteiro.metadata.session_id == "123"
    assert roteiro.passos[0].tag_alvo == "button"


def test_ingest_whitelist_validation(client, monkeypatch):
    import json
    import os
    import api.db_services

    test_org_id = "00000000-0000-0000-0000-000000000001"
    monkeypatch.setattr(api.db_services, "get_or_create_organization_for_user", lambda *args, **kwargs: test_org_id)
    api.db_services.save_organization_settings(test_org_id, {
        "disable_whitelist": False,
        "allowed_domains": ["localhost", "127.0.0.1", "senior.com.br", "senior.com"]
    })

    allowed_urls = [
        "http://localhost/somepath",
        "http://127.0.0.1:8000/page",
        "https://senior.com.br",
        "https://painel.senior.com.br/dashboard",
        "https://senior.com",
        "https://hcm.senior.com/colaboradores",
        "https://sandbox.client.com/test",
        "http://staging.my-site.com",
        "https://homologacao.company.com.br",
    ]
    
    disallowed_urls = [
        "https://google.com",
        "https://youtube.com/watch?v=123",
        "https://anotherdomain.com",
    ]
    
    import uuid
    run_uid = uuid.uuid4().hex[:6]
    for i, url in enumerate(allowed_urls):
        data = {
            "session_id": f"sess_allowed_{run_uid}_{i}",
            "events": json.dumps([
                {
                    "timestamp": 123456789,
                    "type": "click",
                    "url": url,
                    "eventData": {
                        "action": "click",
                        "target_tag": "BUTTON",
                        "target_text": "Salvar",
                        "a11y_tree": []
                    }
                }
            ]),
            "modo_input": "A"
        }
        files = [("video", ("capture.webm", b"dummy-video-bytes", "video/webm"))]
        response = client.post("/api/v1/capture/ingest", data=data, files=files)
        assert response.status_code == 200, f"Failed for allowed url: {url}"
        
    for i, url in enumerate(disallowed_urls):
        data = {
            "session_id": f"sess_disallowed_{run_uid}_{i}",
            "events": json.dumps([
                {
                    "timestamp": 123456789,
                    "type": "click",
                    "url": url,
                    "eventData": {
                        "action": "click",
                        "target_tag": "BUTTON",
                        "target_text": "Salvar",
                        "a11y_tree": []
                    }
                }
            ]),
            "modo_input": "A"
        }
        files = [("video", ("capture.webm", b"dummy-video-bytes", "video/webm"))]
        response = client.post("/api/v1/capture/ingest", data=data, files=files)
        assert response.status_code == 403, f"Allowed disallowed url: {url}"
        assert response.json()["detail"] == "Contém eventos de domínios não permitidos na whitelist."


def test_dynamic_whitelist_settings_and_ingestion(client, monkeypatch):
    import json
    import os
    import api.db_services

    monkeypatch.setattr(api.db_services, "get_or_create_organization_for_user", lambda *args, **kwargs: "00000000-0000-0000-0000-000000000099")

    settings_file = "data/organization_settings.json"
    if os.path.exists(settings_file):
        try:
            os.remove(settings_file)
        except Exception:
            pass

    try:
        # 1. Fetch default settings (disable_whitelist default is True)
        res = client.get("/api/v1/admin/settings")
        assert res.status_code == 200
        settings = res.json()
        assert settings["disable_whitelist"] is True
        assert "localhost" in settings["allowed_domains"]
        assert "senior.com.br" in settings["allowed_domains"]

        # 2. Save settings to disable whitelist
        res = client.post("/api/v1/admin/settings", json={
            "disable_whitelist": True,
            "allowed_domains": ["localhost"]
        })
        assert res.status_code == 200

        # Verify settings updated
        res = client.get("/api/v1/admin/settings")
        assert res.json()["disable_whitelist"] is True

        # Ingest event with disallowed domain (e.g., google.com) while whitelist is disabled
        data = {
            "session_id": "sess_dynamic_disabled",
            "events": json.dumps([
                {
                    "timestamp": 123456789,
                    "type": "click",
                    "url": "https://google.com/search",
                    "eventData": {
                        "action": "click",
                        "target_tag": "BUTTON",
                        "target_text": "Search",
                        "a11y_tree": []
                    }
                }
            ]),
            "modo_input": "A"
        }
        files = [("video", ("capture.webm", b"dummy-video-bytes", "video/webm"))]
        response = client.post("/api/v1/capture/ingest", data=data, files=files)
        # Should succeed because whitelist is disabled!
        assert response.status_code == 200

        # 3. Enable whitelist again but only allow a custom domain
        res = client.post("/api/v1/admin/settings", json={
            "disable_whitelist": False,
            "allowed_domains": ["customdomain.com"]
        })
        assert res.status_code == 200

        # Ingest google.com (should fail now)
        data["session_id"] = "sess_dynamic_enabled_fail"
        response = client.post("/api/v1/capture/ingest", data=data, files=files)
        assert response.status_code == 403

        # Ingest customdomain.com (should succeed now)
        data["session_id"] = "sess_dynamic_enabled_success"
        data["events"] = json.dumps([
            {
                "timestamp": 123456789,
                "type": "click",
                "url": "https://customdomain.com/dashboard",
                "eventData": {
                    "action": "click",
                    "target_tag": "BUTTON",
                    "target_text": "Dashboard",
                    "a11y_tree": []
                }
            }
        ])
        response = client.post("/api/v1/capture/ingest", data=data, files=files)
        assert response.status_code == 200

    finally:
        if os.path.exists(settings_file):
            try:
                os.remove(settings_file)
            except Exception:
                pass


