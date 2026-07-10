import time
import httpx

API_URL = "http://127.0.0.1:8000"

print("Obtendo token de desenvolvimento temporário...")
try:
    auth_res = httpx.get(f"{API_URL}/api/v1/auth/dev-token", timeout=5.0)
    auth_data = auth_res.json()
    token = auth_data["token"]
    print("Token obtido com sucesso.")
except Exception as e:
    print(f"Não foi possível obter o token dev: {e}")
    token = None

if token:
    headers = {"Authorization": f"Bearer {token}"}
    endpoints = [
        "/api/v1/admin/pipeline-runs",
        "/api/v1/admin/metrics",
        "/api/v1/admin/publications",
        "/api/v1/admin/costs"
    ]

    print("\nIniciando teste de latência dos endpoints da API...")
    for ep in endpoints:
        t0 = time.time()
        try:
            r = httpx.get(f"{API_URL}{ep}", headers=headers, timeout=10.0)
            t1 = time.time()
            print(f"Endpoint: {ep} | Status: {r.status_code} | Tempo: {t1 - t0:.4f}s")
            if r.status_code != 200:
                print(f"   Corpo da Resposta: {r.text}")
        except Exception as e:
            print(f"Endpoint: {ep} | Falhou com erro: {e}")
