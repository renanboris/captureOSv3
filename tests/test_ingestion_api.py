from fastapi.testclient import TestClient
from api.main import app
from contracts.handoff_schema import RoteiroHandoff, MetadataRoteiro, PassoRoteiro

client = TestClient(app)

def test_ingest_endpoint_mock():
    payload = {
        "session_id": "sess_123",
        "events": [
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
        ]
    }
    
    response = client.post("/api/v1/capture/ingest", json=payload)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["status"] == "ok"
    assert len(res_data["roteiro_gerado"]) == 1
    
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
